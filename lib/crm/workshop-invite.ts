import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { MetaWindowError, sendMetaMessage } from "@/lib/meta/send";
import { resolveWindow } from "@/lib/meta/window";
import { sureFirstName } from "@/lib/sure-name";
import { whatsAppDigits } from "@/lib/whatsapp-contact";

import { writeAuditLog } from "./audit";
import { getOperationalTimezone } from "./operational-timezone";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "./whatsapp-ai-config";
import { isIgnoredNumber, phoneHash } from "./whatsapp-ignored-numbers";
import { ensureWhatsAppConversation } from "./whatsapp-outbound";
import { fillVars, templateParams } from "./whatsapp-outbound-plan";
import { estimateTemplateCost } from "./whatsapp-rates";
import {
  approvedTemplateFor,
  ensureTemplatesSubmitted,
  getTemplatePrices,
  getWhatsAppTemplateStatus,
  type WaTemplate,
} from "./whatsapp-templates";
import { chatNameInfo } from "./whatsapp-agent/chat-name";
import { computeSegment } from "./whatsapp-agent/segment-store";
import { waitingRoomBlocked } from "./whatsapp-agent/waiting-room";
import { workshopOutreachSource, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";
import {
  countExclusions,
  declinesInvite,
  INVITE_EXCLUSION_LABEL,
  INVITE_SEND_KIND,
  INVITE_TEMPLATE_KEY,
  INVITE_WINDOW_DAYS,
  inviteBlockedReason,
  inviteClientKey,
  inviteExclusion,
  inviteWindowStart,
  workshopInviteTemplateVars,
  workshopInviteText,
  type InviteEvent,
  type InviteExclusion,
  type InviteFacts,
} from "./workshop-invite-rules";
import { enrolledInWorkshop, workshopPayUrl } from "./workshop-interests";
import { loadOutreachConversation, OUTREACH_CONVERSATION_SELECT, outreachAiOff, outreachRefusal } from "./workshop-outreach-guard";

/**
 * «Invitar a inscritas de eventos gratuitos» (dueña, 28-oct: «las personas que
 * se inscribieron al webinar… que se les envíe una invitación al taller, pero
 * teniendo en cuenta de que es de pago»). Reglas y textos en
 * `workshop-invite-rules.ts`.
 *
 * Nada sale solo: Dayana toca el botón en la pestaña «Interesadas» del taller,
 * ve a cuántas les llega y por qué las demás no (`previewWorkshopInvite`),
 * confirma, y la página pide las tandas (`processWorkshopInviteBatch`) como un
 * envío masivo: queda en `WhatsAppSend` (kind `invitacion_taller`, con el
 * taller) y en la historia del taller. Antes de escribirle a cada persona se
 * vuelve a mirar todo con su estado al día (las reglas de «Que la IA le
 * escriba»: `workshop-outreach-guard.ts`).
 *
 * Una invitación por persona y edición: la clave `taller-invita:<edición>:<contacto>`
 * se reclama antes de enviar (`sendMetaMessage` no repite una clave), y a quien
 * ya tiene una fila enviada, enviándose o fallida de otra tanda no se le vuelve
 * a escribir. Una que falló no se reintenta sola (Cristina, 26-oct: reintentar
 * una plantilla de Marketing que Meta rechaza le baja la calidad al número).
 */

/** Por tanda (cada persona se recalcula: `computeSegment`, su agenda) y el respiro entre mensajes. */
const BATCH_SIZE = 10;
const PAUSE_MS = 150;
/** Tope por envío (el mismo de los envíos masivos). */
const MAX_RECIPIENTS = 2000;

type Deps = {
  send?: typeof sendMetaMessage;
  now?: Date;
  /** Solo las inscritas de estos eventos (las pruebas: la base de desarrollo tiene inscritas de verdad). */
  onlyEventIds?: string[];
  /** Mandar a aprobar la plantilla si falta (en las pruebas, nada: no se llama a 360dialog). */
  ensureTemplates?: (keys: string[]) => Promise<unknown>;
  pauseMs?: number;
};

// ── El taller ───────────────────────────────────────────────────────────────

type InviteEdition = OpenWorkshop & { status: string; endedAt: Date | null; payUrl: string | null };

const loadEdition = async (editionId: string): Promise<InviteEdition | null> => {
  const e = await prisma.workshopEdition.findUnique({
    where: { id: editionId },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      endedAt: true,
      startsAt: true,
      startsAtHasTime: true,
      timezone: true,
      dateLabel: true,
      scheduleLabel: true,
      cardSummary: true,
      product: { select: { id: true, isActive: true, prices: { select: { id: true }, take: 1 } } },
    },
  });
  if (!e) return null;
  const { product, ...rest } = e;
  return { ...rest, payUrl: workshopPayUrl(product) };
};

/** Lo que impide invitar a nadie: el taller cerrado o pasado, sin precio o sin fecha, o la IA apagada. */
const globalBlock = async (edition: InviteEdition, config: WhatsAppAiConfig, now: Date): Promise<string | null> => {
  if (edition.status !== "OPEN" || edition.endedAt || (edition.startsAt && edition.startsAt.getTime() < now.getTime())) {
    return "El taller no tiene las inscripciones abiertas: solo se invita a un taller publicado que todavía no pasó.";
  }
  return inviteBlockedReason(edition) ?? (await outreachAiOff(config));
};

// ── A quién (con el estado guardado de cada chat) ──────────────────────────

type CandidateConversation = {
  id: string;
  lastInboundAt: Date | null;
};

type Candidate = {
  contactId: string;
  name: string | null;
  phoneE164: string | null;
  event: InviteEvent | null;
  conversation: CandidateConversation | null;
  exclusion: InviteExclusion | null;
  windowOpen: boolean;
};

const validPhone = (p: string | null | undefined): string | null => (p && /^\+\d{8,15}$/.test(p) ? p : null);

/**
 * Ya tiene una invitación de esta edición, en cualquier tanda: enviada o
 * fallida (una que falló no se reintenta sola). Lo que está en curso lo
 * cuidan la clave del mensaje y que no se empieza otra con una a medias.
 */
const INVITED_STATUSES = ["SENT", "FAILED"];

const chunked = async <T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
};

/**
 * Todas las inscritas en eventos gratuitos de la ventana, cada una con su
 * motivo para no recibirla (o null). Con el estado guardado de cada chat
 * (segmento, etapa, categoría): al enviar se vuelve a calcular persona a persona.
 */
const loadCandidates = async (
  edition: InviteEdition,
  config: WhatsAppAiConfig,
  now: Date,
  onlyEventIds?: string[]
): Promise<Candidate[]> => {
  const since = inviteWindowStart(now);
  const regs = await prisma.webinarRegistration.findMany({
    where: {
      webinar: { OR: [{ startsAt: { gte: since } }, { startsAt: null, createdAt: { gte: since } }] },
      ...(onlyEventIds ? { webinarId: { in: onlyEventIds } } : {}),
    },
    select: {
      contactId: true,
      webinar: { select: { headline: true, eventLabel: true, startsAt: true, createdAt: true } },
      contact: { select: { firstName: true, lastName: true, phoneE164: true, consentMarketingAt: true, notifyWhatsapp: true } },
    },
  });
  // Una persona por contacto, con el evento más reciente en el que se inscribió.
  const byContact = new Map<string, (typeof regs)[number]>();
  const at = (r: (typeof regs)[number]) => (r.webinar.startsAt ?? r.webinar.createdAt).getTime();
  for (const r of regs) {
    const prev = byContact.get(r.contactId);
    if (!prev || at(r) > at(prev)) byContact.set(r.contactId, r);
  }
  const people = [...byContact.values()];
  const ids = people.map((p) => p.contactId);
  if (ids.length === 0) return [];
  const threadOf = (phone: string | null) => (phone ? whatsAppDigits(phone) : null);
  const threads = [...new Set(people.map((p) => threadOf(validPhone(p.contact.phoneE164))).filter((t): t is string => Boolean(t)))];

  const [conversations, paid, invited, keyed, interests, ignored] = await Promise.all([
    prisma.conversation.findMany({
      where: { channel: "WHATSAPP", OR: [{ contactId: { in: ids } }, { externalThreadId: { in: threads } }] },
      select: {
        ...OUTREACH_CONVERSATION_SELECT,
        lastMessageAt: true,
        dossier: { select: { segment: true, timezone: true, stage: true, segmentReview: true } },
      },
    }),
    prisma.enrollment.findMany({
      where: { workshopEditionId: edition.id, contactId: { in: ids }, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { contactId: true },
    }),
    prisma.whatsAppSendRecipient.findMany({
      where: { contactId: { in: ids }, status: { in: INVITED_STATUSES }, send: { kind: INVITE_SEND_KIND, workshopEditionId: edition.id } },
      select: { contactId: true },
    }),
    prisma.conversationMessage.findMany({
      where: { clientKey: { in: ids.map((id) => inviteClientKey(edition.id, id)) } },
      select: { clientKey: true },
    }),
    prisma.$queryRaw<{ conversation_id: string }[]>`SELECT conversation_id FROM workshop_interests WHERE edition_id = ${edition.id}`,
    prisma.whatsAppIgnoredNumber.findMany({
      where: { phoneHash: { in: threads.map(phoneHash).filter((h): h is string => Boolean(h)) } },
      select: { phoneHash: true },
    }),
  ]);
  const convIds = conversations.map((c) => c.id);
  const [appointments, bookings] = await Promise.all([
    prisma.calendarAppointment.findMany({
      where: { status: "active", startsAt: { gte: now }, OR: [{ conversationId: { in: convIds } }, { contactId: { in: ids } }] },
      select: { conversationId: true, contactId: true },
    }),
    prisma.whatsAppBooking.findMany({
      where: { conversationId: { in: convIds }, startsAt: { gte: now }, status: { notIn: ["CANCELLED", "cancelled"] } },
      select: { conversationId: true },
    }),
  ]);

  const paidSet = new Set(paid.map((p) => p.contactId));
  const invitedSet = new Set([...invited.map((r) => r.contactId), ...keyed.map((m) => m.clientKey?.split(":")[2])]);
  const interestSet = new Set(interests.map((i) => i.conversation_id));
  const ignoredSet = new Set(ignored.map((i) => i.phoneHash));
  const callConv = new Set([...appointments.map((a) => a.conversationId), ...bookings.map((b) => b.conversationId)]);
  const callContact = new Set(appointments.map((a) => a.contactId));
  const convFor = (contactId: string, thread: string | null) => {
    const mine = conversations.filter((c) => c.contactId === contactId || (thread && c.externalThreadId === thread));
    mine.sort(
      (a, b) =>
        Number(b.contactId === contactId) - Number(a.contactId === contactId) ||
        (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)
    );
    return mine[0] ?? null;
  };

  return chunked(people, 20, async (p): Promise<Candidate> => {
    const phone = validPhone(p.contact.phoneE164);
    const thread = threadOf(phone);
    const conv = convFor(p.contactId, thread);
    const hash = thread ? phoneHash(thread) : null;
    const facts: InviteFacts = {
      consentMarketing: Boolean(p.contact.consentMarketingAt),
      optedOut: p.contact.notifyWhatsapp === false,
      phoneOk: Boolean(phone),
      paidWorkshop: paidSet.has(p.contactId),
      segment: conv?.dossier?.segment ?? null,
      stage: conv?.dossier?.stage ?? null,
      segmentReview: conv?.dossier?.segmentReview ?? false,
      category: conv?.category ?? null,
      categorySource: conv?.categorySource ?? null,
      ignoredNumber: Boolean(hash && ignoredSet.has(hash)),
      alreadyInvited: invitedSet.has(p.contactId),
      inInterests: Boolean(conv && interestSet.has(conv.id)),
      hasUpcomingCall: Boolean((conv && callConv.has(conv.id)) || callContact.has(p.contactId)),
      aiBlocked: false,
    };
    let exclusion = inviteExclusion(facts);
    // Lo que cuesta una consulta (el número ignorado, Manual, pausa…), solo para quien llegó hasta aquí.
    if (!exclusion && conv && ((conv.assignedStaffId && !conv.aiAlwaysAt) || (await waitingRoomBlocked(conv, config)))) {
      exclusion = inviteExclusion({ ...facts, aiBlocked: true });
    }
    return {
      contactId: p.contactId,
      name: [p.contact.firstName, p.contact.lastName].filter(Boolean).join(" ").trim() || null,
      phoneE164: phone,
      event: { headline: p.webinar.headline, eventLabel: p.webinar.eventLabel, startsAt: p.webinar.startsAt },
      conversation: conv ? { id: conv.id, lastInboundAt: conv.lastInboundAt } : null,
      exclusion,
      windowOpen: resolveWindow("WHATSAPP", conv?.lastInboundAt ?? null, now).isOpen,
    };
  });
};

// ── La vista previa ────────────────────────────────────────────────────────

export type InvitePreview = {
  /** Por qué no se puede invitar a nadie ahora (el taller, el precio, la IA). */
  blocked: string | null;
  windowDays: number;
  /** Los eventos de la ventana y cuántas personas de cada uno (por su evento más reciente). */
  events: { headline: string; startsAtIso: string | null; people: number }[];
  /** Personas distintas inscritas en esos eventos. */
  registered: number;
  /** Les llegaría (pasan todas las reglas). */
  eligible: number;
  /** De ellas, por mensaje (escribieron en las últimas 24 h, gratis) o por plantilla (Meta la cobra). */
  viaText: number;
  viaTemplate: number;
  template: { key: string; status: string | null; approved: boolean };
  /** Las que salen ahora: por mensaje, más por plantilla si ya está aprobada. */
  sendableNow: number;
  estimatedCost: number;
  currency: string;
  excluded: { reason: InviteExclusion; label: string; count: number }[];
  sample: { name: string | null; via: "text" | "template" }[];
  /** Cómo se ve el mensaje (sin nombre: a cada persona, el suyo si es seguro). */
  textExample: string;
  /** Una invitación a medias de este taller (se continúa, no se crea otra). */
  inProgress: { sendId: string; pending: number } | null;
};

const inProgressFor = async (editionId: string) => {
  const send = await prisma.whatsAppSend.findFirst({
    where: { kind: INVITE_SEND_KIND, workshopEditionId: editionId, status: "SENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!send) return null;
  const pending = await prisma.whatsAppSendRecipient.count({ where: { sendId: send.id, status: { in: ["PENDING", "SENDING"] } } });
  return pending > 0 ? { sendId: send.id, pending } : null;
};

const computePreview = async (editionId: string, deps: Deps) => {
  const now = deps.now ?? new Date();
  const edition = await loadEdition(editionId);
  if (!edition) return null;
  const config = await getWhatsAppAiConfig();
  const [blocked, candidates, template, status, prices, tz, inProgress] = await Promise.all([
    globalBlock(edition, config, now),
    loadCandidates(edition, config, now, deps.onlyEventIds),
    approvedTemplateFor(INVITE_TEMPLATE_KEY),
    getWhatsAppTemplateStatus(INVITE_TEMPLATE_KEY).catch(() => null),
    getTemplatePrices(),
    getOperationalTimezone(),
    inProgressFor(editionId),
  ]);
  const eligible = candidates.filter((c) => !c.exclusion);
  const viaText = eligible.filter((c) => c.windowOpen);
  const viaTemplate = eligible.filter((c) => !c.windowOpen);
  const cost = estimateTemplateCost(
    template ? viaTemplate.map((c) => c.phoneE164) : [],
    "MARKETING",
    prices
  );
  const events = new Map<string, { headline: string; startsAtIso: string | null; people: number }>();
  for (const c of candidates) {
    const key = `${c.event?.headline}|${c.event?.startsAt?.toISOString() ?? ""}`;
    const row = events.get(key) ?? { headline: c.event?.headline ?? "", startsAtIso: c.event?.startsAt?.toISOString() ?? null, people: 0 };
    row.people += 1;
    events.set(key, row);
  }
  const preview: InvitePreview = {
    blocked,
    windowDays: INVITE_WINDOW_DAYS,
    events: [...events.values()].sort((a, b) => (b.startsAtIso ?? "").localeCompare(a.startsAtIso ?? "")),
    registered: candidates.length,
    eligible: eligible.length,
    viaText: viaText.length,
    viaTemplate: viaTemplate.length,
    template: { key: INVITE_TEMPLATE_KEY, status, approved: Boolean(template) },
    sendableNow: blocked ? 0 : viaText.length + (template ? viaTemplate.length : 0),
    estimatedCost: cost.total,
    currency: cost.currency,
    excluded: countExclusions(candidates.map((c) => c.exclusion)),
    sample: eligible.slice(0, 8).map((c) => ({ name: c.name, via: c.windowOpen ? "text" : "template" })),
    textExample: workshopInviteText(edition, { firstName: null, event: eligible[0]?.event ?? null, timeZone: tz }),
    inProgress,
  };
  return { preview, edition, candidates, template };
};

/** A cuántas les llegaría y por qué a las demás no. No envía nada. */
export const previewWorkshopInvite = async (editionId: string, deps: Deps = {}): Promise<InvitePreview | null> => {
  const r = await computePreview(editionId, deps);
  if (!r) return null;
  // La plantilla se manda sola a aprobar si falta o Meta la rechazó (gratis; una vez cada 30 min
  // como mucho), aunque hoy no haga falta: la aprobación tarda y las que lleguen después la esperarían.
  if (!r.preview.template.approved) {
    void (deps.ensureTemplates ?? ensureTemplatesSubmitted)([INVITE_TEMPLATE_KEY]).catch(() => undefined);
  }
  return r.preview;
};

// ── Empezar, por tandas, cancelar ──────────────────────────────────────────

export type StartResult =
  | { status: "started"; sendId: string; total: number }
  | { status: "in_progress"; sendId: string; pending: number }
  | { status: "blocked"; message: string };

/** Prepara el envío con quienes pasan las reglas ahora (y por plantilla, solo si ya está aprobada). */
export const startWorkshopInvite = async (input: { editionId: string; staffId: string }, deps: Deps = {}): Promise<StartResult> => {
  const r = await computePreview(input.editionId, deps);
  if (!r) return { status: "blocked", message: "El taller no existe." };
  const { preview, edition, candidates, template } = r;
  if (preview.inProgress) return { status: "in_progress", ...preview.inProgress };
  if (preview.blocked) return { status: "blocked", message: preview.blocked };
  const recipients = candidates.filter((c) => !c.exclusion && (c.windowOpen || template)).slice(0, MAX_RECIPIENTS);
  if (recipients.length === 0) {
    return {
      status: "blocked",
      message:
        preview.eligible > 0
          ? "Las que faltan no escribieron en las últimas 24 h y la plantilla todavía no está aprobada por Meta. Cuando la apruebe, vuelve a tocar el botón."
          : "No hay a quién invitar ahora.",
    };
  }
  const send = await prisma.whatsAppSend.create({
    data: {
      title: `Taller: ${edition.title} (invitación a inscritas de eventos gratuitos)`.slice(0, 200),
      kind: INVITE_SEND_KIND,
      text: preview.textExample,
      templateKey: INVITE_TEMPLATE_KEY,
      status: "SENDING",
      total: recipients.length,
      createdById: input.staffId,
      workshopEditionId: edition.id,
      recipients: { create: recipients.map((c) => ({ contactId: c.contactId, phone: c.phoneE164, name: c.name })) },
    },
    select: { id: true, total: true },
  });
  await writeAuditLog({
    staffUserId: input.staffId,
    action: "WHATSAPP_BULK_CREATED",
    entityType: "WhatsAppSend",
    entityId: send.id,
    changes: {
      kind: INVITE_SEND_KIND,
      workshopEditionId: edition.id,
      total: send.total,
      windowDays: INVITE_WINDOW_DAYS,
      registered: preview.registered,
      viaText: recipients.filter((c) => c.windowOpen).length,
      viaTemplate: recipients.filter((c) => !c.windowOpen).length,
      excluded: Object.fromEntries(preview.excluded.map((e) => [e.reason, e.count])),
    },
  }).catch(() => undefined);
  return { status: "started", sendId: send.id, total: send.total };
};

export type InviteProgress = {
  id: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  notice?: string;
};

const progressOf = async (sendId: string, notice?: string): Promise<InviteProgress> => {
  const send = await prisma.whatsAppSend.findUniqueOrThrow({ where: { id: sendId } });
  const pending = await prisma.whatsAppSendRecipient.count({ where: { sendId, status: { in: ["PENDING", "SENDING"] } } });
  return { id: sendId, status: send.status, total: send.total, sent: send.sent, failed: send.failed, skipped: send.skipped, pending, ...(notice ? { notice } : {}) };
};

type RowOutcome = {
  status: "SENT" | "SKIPPED" | "NEEDS_TEMPLATE" | "OPTED_OUT" | "NO_PHONE" | "FAILED";
  mode?: "text" | "template";
  conversationId?: string | null;
  messageId?: string | null;
  error?: string | null;
};

const skipped = (reason: InviteExclusion, conversationId?: string | null): RowOutcome =>
  reason === "opted_out"
    ? { status: "OPTED_OUT", conversationId }
    : reason === "no_phone"
      ? { status: "NO_PHONE", conversationId }
      : { status: "SKIPPED", error: INVITE_EXCLUSION_LABEL[reason], conversationId };

/** Una persona: todo otra vez con su estado al día, y la invitación (texto o plantilla). */
const inviteOne = async (
  row: { id: string; contactId: string | null },
  ctx: { edition: InviteEdition; config: WhatsAppAiConfig; template: WaTemplate | null; now: Date; tz: string; send: typeof sendMetaMessage }
): Promise<RowOutcome> => {
  const { edition, config, template, now } = ctx;
  if (!row.contactId) return { status: "FAILED", error: "El contacto ya no existe." };
  const contact = await prisma.contact.findUnique({
    where: { id: row.contactId },
    select: { id: true, firstName: true, lastName: true, phoneE164: true, consentMarketingAt: true, notifyWhatsapp: true },
  });
  if (!contact) return { status: "FAILED", error: "El contacto ya no existe." };

  // Esta misma fila ya salió (la tanda se cortó y la recuperación la devolvió a la cola).
  const clientKey = inviteClientKey(edition.id, contact.id);
  const existing = await prisma.conversationMessage.findUnique({
    where: { clientKey },
    select: { id: true, status: true, conversationId: true, failedReason: true },
  });
  if (existing) {
    return existing.status === "FAILED"
      ? { status: "FAILED", conversationId: existing.conversationId, messageId: existing.id, error: existing.failedReason ?? "WhatsApp no lo entregó." }
      : { status: "SENT", conversationId: existing.conversationId, messageId: existing.id };
  }
  const elsewhere = await prisma.whatsAppSendRecipient.count({
    where: {
      id: { not: row.id },
      contactId: contact.id,
      status: { in: ["SENDING", "SENT", "FAILED"] },
      send: { kind: INVITE_SEND_KIND, workshopEditionId: edition.id },
    },
  });

  const phone = validPhone(contact.phoneE164);
  const base: InviteFacts = {
    consentMarketing: Boolean(contact.consentMarketingAt),
    optedOut: contact.notifyWhatsapp === false,
    phoneOk: Boolean(phone),
    paidWorkshop: await enrolledInWorkshop(contact.id, edition.id),
    segment: null,
    stage: null,
    segmentReview: false,
    category: null,
    categorySource: null,
    ignoredNumber: phone ? await isIgnoredNumber(whatsAppDigits(phone)) : false,
    alreadyInvited: elsewhere > 0,
    inInterests: false,
    hasUpcomingCall: false,
    aiBlocked: false,
  };
  // Lo que se sabe sin tocar el chat (no se crea un chat para quien no la va a recibir).
  const early = inviteExclusion(base);
  if (early) return skipped(early);

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || null;
  const { id: conversationId } = await ensureWhatsAppConversation({ phoneE164: phone!, contactId: contact.id, name });
  const seg = await computeSegment(conversationId).catch(() => null);
  const conv = await loadOutreachConversation(conversationId);
  if (!conv) return { status: "FAILED", error: "No se encontró su chat de WhatsApp." };
  const [interest] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM workshop_interests WHERE edition_id = ${edition.id} AND conversation_id = ${conversationId}`;
  const refusal = await outreachRefusal(conv, { editionId: edition.id, config, now, seg, pastClientsOk: false });
  const facts: InviteFacts = {
    ...base,
    paidWorkshop: base.paidWorkshop || refusal?.reason === "paid",
    segment: seg?.segment ?? null,
    stage: seg?.stage ?? null,
    segmentReview: Boolean(seg?.review),
    category: conv.category,
    categorySource: conv.categorySource,
    inInterests: Boolean(interest),
    hasUpcomingCall: refusal?.reason === "has_call",
    aiBlocked: refusal?.reason === "assigned" || refusal?.reason === "blocked",
  };
  // El guardián dice «por revisar, clienta o personal» sin decir cuál: lo que
  // el segmento no explique cuenta como por revisar (no sale).
  const exclusion = inviteExclusion(facts) ?? (refusal ? "review" : null);
  if (exclusion) return skipped(exclusion, conversationId);

  const windowOpen = resolveWindow("WHATSAPP", conv.lastInboundAt, now).isOpen;
  if (!windowOpen && !template?.metaTemplateName) return { status: "NEEDS_TEMPLATE", conversationId };
  const firstName = sureFirstName(await chatNameInfo(conversationId));
  const lastReg = await prisma.webinarRegistration.findFirst({
    where: { contactId: contact.id, webinar: { OR: [{ startsAt: { gte: inviteWindowStart(now) } }, { startsAt: null }] } },
    orderBy: { createdAt: "desc" },
    select: { webinar: { select: { headline: true, eventLabel: true, startsAt: true } } },
  });
  const source = workshopOutreachSource(edition);
  try {
    if (windowOpen) {
      const result = await ctx.send({
        conversationId,
        body: workshopInviteText(edition, { firstName, event: lastReg?.webinar ?? null, timeZone: ctx.tz }),
        source,
        isAutoReply: true,
        clientKey,
      });
      return { status: "SENT", mode: "text", conversationId, messageId: result.messageId };
    }
    const vars = workshopInviteTemplateVars(edition, { firstName });
    const result = await ctx.send({
      conversationId,
      body: fillVars(template!.body, vars),
      template: {
        name: template!.metaTemplateName!,
        language: template!.metaTemplateLang ?? "es",
        variables: templateParams(template!.metaVarNames, vars),
      },
      source,
      isAutoReply: true,
      clientKey,
    });
    return { status: "SENT", mode: "template", conversationId, messageId: result.messageId };
  } catch (e) {
    if (e instanceof MetaWindowError) return { status: "NEEDS_TEMPLATE", conversationId };
    return { status: "FAILED", conversationId, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
};

/** La siguiente tanda. La página la pide hasta que no queda nadie. */
export const processWorkshopInviteBatch = async (
  input: { sendId: string; staffId: string; batchSize?: number },
  deps: Deps = {}
): Promise<InviteProgress> => {
  const now = deps.now ?? new Date();
  const send = await prisma.whatsAppSend.findUnique({ where: { id: input.sendId } });
  if (!send || send.kind !== INVITE_SEND_KIND || !send.workshopEditionId) throw new Error("El envío no existe.");
  if (send.status === "CANCELLED" || send.status === "DONE") return progressOf(send.id);

  const edition = await loadEdition(send.workshopEditionId);
  const config = await getWhatsAppAiConfig();
  const stop = edition ? await globalBlock(edition, config, now) : "El taller ya no existe.";
  if (stop || !edition) {
    // Nadie queda «invitada»: las que faltan quedan para otra vez.
    const left = await prisma.whatsAppSendRecipient.updateMany({
      where: { sendId: send.id, status: "PENDING" },
      data: { status: "SKIPPED", error: stop, processedAt: now },
    });
    await prisma.whatsAppSend.update({
      where: { id: send.id },
      data: { status: "DONE", finishedAt: now, skipped: { increment: left.count } },
    });
    return progressOf(send.id, stop ?? undefined);
  }

  const [template, tz] = await Promise.all([approvedTemplateFor(INVITE_TEMPLATE_KEY), getOperationalTimezone()]);
  const rows = await prisma.whatsAppSendRecipient.findMany({
    where: { sendId: send.id, status: "PENDING" },
    take: input.batchSize ?? BATCH_SIZE,
    orderBy: { id: "asc" },
    select: { id: true, contactId: true },
  });
  const pause = deps.pauseMs ?? PAUSE_MS;
  for (const row of rows) {
    // Se reclama antes de enviar: si la invocación se corta, no se repite.
    const claimed = await prisma.whatsAppSendRecipient.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING", processedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    const outcome = await inviteOne(row, { edition, config, template, now, tz, send: deps.send ?? sendMetaMessage }).catch(
      (e: unknown): RowOutcome => ({ status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
    );
    await prisma.whatsAppSendRecipient.update({
      where: { id: row.id },
      data: {
        status: outcome.status,
        mode: outcome.mode ?? null,
        conversationId: outcome.conversationId ?? null,
        messageId: outcome.messageId ?? null,
        error: outcome.error ?? null,
        processedAt: new Date(),
      },
    });
    await prisma.whatsAppSend.update({
      where: { id: send.id },
      data:
        outcome.status === "SENT"
          ? { sent: { increment: 1 } }
          : outcome.status === "FAILED"
            ? { failed: { increment: 1 } }
            : { skipped: { increment: 1 } },
    });
    if (outcome.status === "SENT" && pause > 0) await new Promise((r) => setTimeout(r, pause));
  }

  const remaining = await prisma.whatsAppSendRecipient.count({ where: { sendId: send.id, status: { in: ["PENDING", "SENDING"] } } });
  if (remaining === 0) {
    const done = await prisma.whatsAppSend.updateMany({
      where: { id: send.id, status: "SENDING" },
      data: { status: "DONE", finishedAt: new Date() },
    });
    if (done.count > 0) {
      const final = await prisma.whatsAppSend.findUniqueOrThrow({ where: { id: send.id } });
      await writeAuditLog({
        staffUserId: input.staffId,
        action: "WHATSAPP_BULK_FINISHED",
        entityType: "WhatsAppSend",
        entityId: send.id,
        changes: { kind: INVITE_SEND_KIND, workshopEditionId: edition.id, sent: final.sent, failed: final.failed, skipped: final.skipped },
      }).catch(() => undefined);
    }
  }
  return progressOf(send.id);
};

export const cancelWorkshopInvite = async (input: { sendId: string; staffId: string }): Promise<boolean> => {
  const send = await prisma.whatsAppSend.findUnique({ where: { id: input.sendId }, select: { kind: true, workshopEditionId: true } });
  if (!send || send.kind !== INVITE_SEND_KIND) return false;
  await prisma.whatsAppSend.update({ where: { id: input.sendId }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await prisma.whatsAppSendRecipient.updateMany({ where: { sendId: input.sendId, status: "PENDING" }, data: { status: "CANCELLED" } });
  await writeAuditLog({
    staffUserId: input.staffId,
    action: "WHATSAPP_BULK_CANCELLED",
    entityType: "WhatsAppSend",
    entityId: input.sendId,
    changes: { kind: INVITE_SEND_KIND, workshopEditionId: send.workshopEditionId },
  }).catch(() => undefined);
  return true;
};

// ── A quién se invitó, y sus respuestas ────────────────────────────────────

export type InvitationRow = {
  contactId: string;
  name: string | null;
  phone: string | null;
  conversationId: string | null;
  /** SENT | FAILED | NEEDS_TEMPLATE | SKIPPED | OPTED_OUT | NO_PHONE */
  status: string;
  mode: "text" | "template" | null;
  at: Date | null;
  error: string | null;
  /** Su primera respuesta después de la invitación. */
  answeredAt: Date | null;
};

const RANK: Record<string, number> = { SENT: 0, SENDING: 1, FAILED: 2, NEEDS_TEMPLATE: 3, SKIPPED: 4, OPTED_OUT: 5, NO_PHONE: 6 };

/** Una fila por persona (la mejor de todas las tandas: enviada antes que fallida o saltada), la más reciente primero. */
export const listWorkshopInvitations = async (editionId: string): Promise<InvitationRow[]> => {
  const rows = await prisma.$queryRaw<
    {
      contact_id: string | null;
      name: string | null;
      phone: string | null;
      conversation_id: string | null;
      status: string;
      mode: string | null;
      processed_at: Date | null;
      error: string | null;
      answered_at: Date | null;
    }[]
  >`
    SELECT r.contact_id, r.name, r.phone, r.conversation_id, r.status, r.mode, r.processed_at, r.error,
           (SELECT MIN(m.sent_at) FROM conversation_messages m
             WHERE r.status = 'SENT' AND m.conversation_id = r.conversation_id
               AND m.direction = 'INBOUND' AND m.sent_at > r.processed_at) AS answered_at
    FROM whatsapp_send_recipients r
    JOIN whatsapp_sends s ON s.id = r.send_id
    WHERE s.kind = ${INVITE_SEND_KIND} AND s.workshop_edition_id = ${editionId}
      AND r.status NOT IN ('PENDING', 'CANCELLED')
    ORDER BY r.processed_at DESC NULLS LAST
    LIMIT 1000`;
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.contact_id) continue;
    const prev = best.get(r.contact_id);
    if (!prev || (RANK[r.status] ?? 9) < (RANK[prev.status] ?? 9)) best.set(r.contact_id, r);
  }
  return [...best.values()]
    .sort((a, b) => (b.processed_at?.getTime() ?? 0) - (a.processed_at?.getTime() ?? 0))
    .map((r) => ({
      contactId: r.contact_id!,
      name: r.name,
      phone: r.phone,
      conversationId: r.conversation_id,
      status: r.status,
      mode: r.mode === "text" || r.mode === "template" ? r.mode : null,
      at: r.processed_at,
      error: r.error,
      answeredAt: r.answered_at,
    }));
};

/**
 * Quien contestó a la invitación entra en «Interesadas» (en las 72 h en que
 * su respuesta sigue lo del taller: `workshopOutreachRecent`), con «La IA le escribió · fecha». Si ya
 * estaba (preguntó por el taller), solo se le pone esa fecha. «No me
 * interesa» entra ya marcada «No le interesa». Idempotente.
 */
export const syncInviteReplies = async (edition: { id: string }): Promise<number> => {
  const rows = await prisma.$queryRaw<
    { conversation_id: string; processed_at: Date; mode: string | null; body: string | null; replied_at: Date }[]
  >`
    SELECT DISTINCT ON (r.conversation_id) r.conversation_id, r.processed_at, r.mode, m.body, m.sent_at AS replied_at
    FROM whatsapp_send_recipients r
    JOIN whatsapp_sends s ON s.id = r.send_id
    JOIN conversation_messages m ON m.conversation_id = r.conversation_id AND m.direction = 'INBOUND'
      AND m.sent_at > r.processed_at AND m.sent_at <= r.processed_at + INTERVAL '72 hours'
    WHERE s.kind = ${INVITE_SEND_KIND} AND s.workshop_edition_id = ${edition.id}
      AND r.status = 'SENT' AND r.conversation_id IS NOT NULL AND r.processed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM workshop_interests i
        WHERE i.edition_id = s.workshop_edition_id AND i.conversation_id = r.conversation_id AND i.offered_at IS NOT NULL)
    ORDER BY r.conversation_id, m.sent_at ASC`;
  let changed = 0;
  for (const r of rows) {
    const body = (r.body ?? "").trim() || "(respondió a la invitación con un archivo o un audio)";
    const status = declinesInvite(r.body) ? "descartada" : "contactada";
    changed += await prisma.$executeRaw`
      INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, offered_at, offered_via, updated_at)
      VALUES (${randomUUID()}, ${edition.id}, ${r.conversation_id}, ${body.slice(0, 500)}, ${r.replied_at}, ${r.replied_at}, 1, ${status}, ${r.processed_at}, ${r.mode === "template" ? "template" : "text"}, NOW())
      ON CONFLICT (edition_id, conversation_id) DO UPDATE
        SET offered_at = EXCLUDED.offered_at, offered_via = EXCLUDED.offered_via, updated_at = NOW()
        WHERE workshop_interests.offered_at IS NULL`;
  }
  return changed;
};
