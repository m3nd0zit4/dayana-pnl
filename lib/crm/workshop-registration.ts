import { createHmac, randomUUID } from "node:crypto";
import { ContactSource, Prisma } from "@prisma/client";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import { prisma } from "@/lib/db";
import { MetaWindowError, sendMetaMessage } from "@/lib/meta/send";
import { resolveWindow } from "@/lib/meta/window";
import { resolveWhatsAppThreadId } from "@/lib/meta/whatsapp-thread";
import { personFirstName } from "@/lib/person-name";
import { normalizePhone, normalizePhoneWithCountry } from "@/lib/phone";
import { foldForSearch } from "./search-normalize";
import { contactPhoneCandidates, whatsAppDigits } from "@/lib/whatsapp-contact";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";

import { upsertContactByPhone } from "./contacts";
import { confirmationCapReason } from "./free-event-rules";
import { ensureContactTag } from "./tags";
import { getWhatsAppAiConfig } from "./whatsapp-ai-config";
import { isIgnoredNumber } from "./whatsapp-ignored-numbers";
import { ensureWhatsAppConversation } from "./whatsapp-outbound";
import { fillVars, templateParams } from "./whatsapp-outbound-plan";
import { approvedTemplateFor, ensureTemplatesSubmitted } from "./whatsapp-templates";
import { computeSegment } from "./whatsapp-agent/segment-store";
import { workshopOutreachSource, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";
import { workshopPayUrl } from "./workshop-interests";
import { loadOutreachConversation, outreachAiOff, outreachRefusal } from "./workshop-outreach-guard";
import {
  isRegistrationOpen,
  PAGE_REGISTRATION_MESSAGE,
  pageVia,
  REGISTRATION_TEMPLATE_KEY,
  REGISTRATION_TEMPLATES_PER_IP_PER_DAY,
  registrationClaimable,
  registrationClientKey,
  registrationSkip,
  registrationSourceDetail,
  RETRYABLE_STATES,
  templateCountryAllowed,
  WORKSHOP_INTEREST_TAG_LABEL,
  WORKSHOP_INTEREST_TAG_SLUG,
  WORKSHOP_REGISTRATION_TEMPLATE_CAP,
  workshopRegistrationTemplateVars,
  workshopRegistrationText,
  type RegistrationInput,
  type RegistrationState,
} from "./workshop-registration-rules";

/**
 * El registro de interés desde la página del taller (dueña, 28-oct: «la gente
 * que oprime ahí en taller se registra y se clasifica como interesada; una vez
 * clasificada, se le envía un mensaje automático, como se hacen los del
 * webinar, pero en este caso para que realice el pago del taller o agende una
 * llamada gratuita»). Reglas y textos en `workshop-registration-rules.ts`.
 *
 * 1. `registerWorkshopInterest`: el contacto del NÚMERO (etiqueta
 *    `taller-interes`), su chat de WhatsApp (el que ya tiene ese número, o uno
 *    nuevo con `ensureWhatsAppConversation`, como los envíos) y su fila en
 *    «Interesadas». El formulario es público: el correo nunca decide de quién
 *    es el registro ni cambia el teléfono, el correo o el nombre de un contacto
 *    que ya existe (revisión 28-oct). Quien ya pagó esta edición no se anota.
 * 2. `sendWorkshopRegistrationWhatsApp` (después de responder): el mensaje de
 *    la asistente. Texto dentro de las 24 h; fuera, la plantilla de Utilidad
 *    `taller_registro_pagina` en cuanto Meta la aprueba como Utilidad (se manda
 *    sola a aprobar), con topes (por hora, por día, por conexión) y solo a los
 *    países del público. Una vez por persona y edición (se reclama la fila
 *    antes de enviar); lo que no sale por un tope o por la plantilla queda para
 *    reintentar. Nunca a quien pidió la baja, un número personal o ignorado,
 *    una clienta o quien ya pagó —mirando a TODOS los contactos de ese número—.
 *    Sale con `source` `asistente:taller:<edición>`: su respuesta sigue el
 *    flujo del taller (el enlace o la llamada) por 3 días.
 */

// ── El taller ───────────────────────────────────────────────────────────────

export type RegistrationEdition = OpenWorkshop & {
  status: string;
  endedAt: Date | null;
  payUrl: string | null;
  /** `/pagar/p/<producto>`: el botón «Separar mi cupo» de la página (relativo, sirve en cualquier dominio). */
  payPath: string | null;
  open: boolean;
};

const EDITION_SELECT = {
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
} as const;

const toEdition = (e: Prisma.WorkshopEditionGetPayload<{ select: typeof EDITION_SELECT }>, now: Date): RegistrationEdition => {
  const { product, ...rest } = e;
  const payUrl = workshopPayUrl(product);
  return { ...rest, payUrl, payPath: payUrl && product ? `/pagar/p/${product.id}` : null, open: isRegistrationOpen(e, now) };
};

/** La edición por su dirección (nunca «próximo taller»), diga o no que está abierta. */
export const loadRegistrationEdition = async (slug: string, now = new Date()): Promise<RegistrationEdition | null> => {
  if (!slug || slug === PROXIMO_WORKSHOP_SLUG) return null;
  const e = await prisma.workshopEdition.findUnique({ where: { slug }, select: EDITION_SELECT });
  return e ? toEdition(e, now) : null;
};

const loadEditionById = async (id: string, now: Date): Promise<RegistrationEdition | null> => {
  const e = await prisma.workshopEdition.findUnique({ where: { id }, select: EDITION_SELECT });
  return e && e.slug !== PROXIMO_WORKSHOP_SLUG ? toEdition(e, now) : null;
};

/**
 * La edición del botón de Enlaces: la más próxima en la que todavía se puede
 * registrar (`isRegistrationOpen`, más estricta que `openWorkshopForAi`, que
 * sigue un día más para contestar preguntas).
 */
export const openWorkshopForRegistration = async (now = new Date()): Promise<{ title: string; slug: string } | null> => {
  const rows = await prisma.workshopEdition.findMany({
    where: {
      status: "OPEN",
      endedAt: null,
      slug: { not: PROXIMO_WORKSHOP_SLUG },
      OR: [{ startsAt: null }, { startsAt: { gte: new Date(now.getTime() - 48 * 3600_000) } }],
    },
    orderBy: { startsAt: "asc" },
    take: 5,
    select: { title: true, slug: true, status: true, endedAt: true, startsAt: true, startsAtHasTime: true, timezone: true },
  });
  const found = rows.find((r) => isRegistrationOpen(r, now));
  return found ? { title: found.title, slug: found.slug } : null;
};

/** La plantilla del registro tal como la dejó Meta (estado y categoría), o null si nunca se mandó. */
export const registrationTemplateState = async (): Promise<{ status: string | null; category: string | null } | null> => {
  const t = await prisma.messageTemplate.findFirst({
    where: { key: REGISTRATION_TEMPLATE_KEY, metaTemplateName: { not: null } },
    select: { metaApprovalStatus: true, metaCategory: true },
  });
  return t ? { status: t.metaApprovalStatus, category: t.metaCategory } : null;
};

// ── 1. El registro ──────────────────────────────────────────────────────────

/** El chat de WhatsApp que ya tiene ese número (en cualquiera de sus formas), sin crear ni tocar nada. */
const existingChatForPhone = async (phoneE164: string): Promise<{ id: string; contactId: string | null } | null> => {
  const waId = whatsAppDigits(phoneE164);
  const thread = await resolveWhatsAppThreadId(waId);
  return prisma.conversation.findFirst({
    where: { channel: "WHATSAPP", externalThreadId: { in: [...new Set([thread, waId, phoneE164.replace(/\D/g, "")])] } },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, contactId: true },
  });
};

/** Todas las formas en que puede estar guardado ese número (MX 52/521, AR 54/549, BR con o sin 9). */
const phoneForms = (phoneE164: string): string[] => [...new Set([phoneE164, ...contactPhoneCandidates(whatsAppDigits(phoneE164))])];

const paidAny = async (contactIds: string[], editionId: string): Promise<boolean> =>
  contactIds.length > 0 &&
  (await prisma.enrollment.count({
    where: { contactId: { in: contactIds }, workshopEditionId: editionId, status: { in: ["ACTIVE", "COMPLETED"] } },
  })) > 0;

/** ¿Alguno es clienta? Un pago aprobado o una inscripción activa pagada (como `resolveSegment`). */
const clientAny = async (contactIds: string[]): Promise<boolean> =>
  contactIds.length > 0 &&
  (await prisma.enrollment.count({
    where: {
      contactId: { in: contactIds },
      OR: [{ payments: { some: { status: "APPROVED" } } }, { status: { in: ["ACTIVE", "COMPLETED"] }, amountMinor: { gt: 0 } }],
    },
  })) > 0;

const appendNote = async (contactId: string, line: string): Promise<void> => {
  const current = await prisma.contact.findUnique({ where: { id: contactId }, select: { notes: true } });
  await prisma.contact.update({ where: { id: contactId }, data: { notes: current?.notes ? `${current.notes}\n${line}` : line } });
};

export type RegisterResult =
  | {
      status: "registered";
      contactId: string;
      conversationId: string;
      interestId: string;
      phoneE164: string;
      /** Ya se había registrado en la página para esta edición: sin nota ni aviso al equipo otra vez. */
      alreadyRegistered: boolean;
      /**
       * El nombre para el WhatsApp: el que escribió si el contacto es nuevo o
       * coincide con el que ya tenía; si no, ninguno (el número es de alguien que
       * pudo no ser quien escribió el formulario).
       */
      firstName: string | null;
    }
  /** Ya pagó esta edición: no se anota (la página dice lo mismo que a todos). */
  | { status: "enrolled"; contactId: string }
  /** Un número personal de Dayana: ni chat ni fila. */
  | { status: "personal"; contactId: string };

/** Lanza `INVALID_PHONE` si el número no sirve. */
export const registerWorkshopInterest = async (
  edition: Pick<RegistrationEdition, "id" | "title">,
  input: RegistrationInput,
  deps: { now?: Date } = {}
): Promise<RegisterResult> => {
  const now = deps.now ?? new Date();
  const country = (input.phoneCountry ?? "CO") as CountryCode;
  const normalized = normalizePhoneWithCountry(input.phone, country) ?? normalizePhone(input.phone, country);
  if (!normalized) throw new Error("INVALID_PHONE");
  const phoneE164 = normalized.phoneE164;

  // El contacto es el del NÚMERO (a donde va el WhatsApp), nunca el del correo.
  const forms = phoneForms(phoneE164);
  const [owners, emailOwner] = await Promise.all([
    prisma.contact.findMany({ where: { phoneE164: { in: forms } }, select: { id: true, phoneE164: true, firstName: true, email: true } }),
    input.email ? prisma.contact.findUnique({ where: { email: input.email }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const owner = owners.find((o) => o.phoneE164 === phoneE164) ?? owners[0] ?? null;
  const sourceDetail = registrationSourceDetail(edition.title, input.ref);
  const typedFirst = personFirstName(input.firstName);
  let contactId: string;
  let firstName: string | null;
  if (!owner) {
    // Nuevo: con su correo solo si no es de otro contacto (si no, `upsertContactByPhone` lo tomaría por ese).
    const { contact } = await upsertContactByPhone({
      phone: phoneE164,
      phoneCountry: normalized.phoneCountryIso,
      firstName: input.firstName,
      lastName: input.lastName ?? undefined,
      email: input.email && !emailOwner ? input.email : undefined,
      source: ContactSource.WEB_LEAD_FORM,
      sourceDetail,
      consentData: true,
      consentMarketing: input.consentMarketing,
    });
    contactId = contact.id;
    firstName = typedFirst;
  } else {
    // Ya existe: el formulario público no le cambia el teléfono, el correo ni el
    // nombre a nadie. Solo completa lo que falta y anota los permisos y el origen.
    const storedFirst = personFirstName(owner.firstName);
    const nameless = !storedFirst || owner.firstName === owner.phoneE164;
    await prisma.contact.update({
      where: { id: owner.id },
      data: {
        consentDataAt: now,
        ...(input.consentMarketing ? { consentMarketingAt: now } : {}),
        sourceDetail,
        ...(nameless && input.firstName
          ? {
              firstName: input.firstName,
              lastName: input.lastName,
              displayName: [input.firstName, input.lastName].filter(Boolean).join(" "),
            }
          : {}),
        ...(input.email && !owner.email && !emailOwner ? { email: input.email } : {}),
      },
    });
    contactId = owner.id;
    firstName = nameless || (storedFirst && typedFirst && foldForSearch(storedFirst) === foldForSearch(typedFirst)) ? typedFirst : null;
  }
  // La etiqueta es para Dayana; si falla, el registro sigue.
  await ensureContactTag(contactId, WORKSHOP_INTEREST_TAG_SLUG, WORKSHOP_INTEREST_TAG_LABEL).catch((e: unknown) =>
    console.warn("[taller-registro] no se pudo poner la etiqueta", e)
  );

  if (await isIgnoredNumber(whatsAppDigits(phoneE164))) return { status: "personal", contactId };

  const existing = await existingChatForPhone(phoneE164);
  const people = [...new Set([contactId, ...owners.map((o) => o.id), existing?.contactId].filter((x): x is string => Boolean(x)))];
  if (await paidAny(people, edition.id)) return { status: "enrolled", contactId };

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
    // Su chat sin contacto queda con el dueño del número; uno que ya es de otro contacto no se toca.
    if (!existing.contactId) {
      await prisma.conversation.updateMany({ where: { id: existing.id, contactId: null }, data: { contactId } });
    }
  } else {
    const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || null;
    conversationId = (await ensureWhatsAppConversation({ phoneE164, contactId, name })).id;
  }

  // Una fila por chat y edición. Si ya estaba (preguntó por WhatsApp o se registró
  // antes), cuenta como otra vez (no un doble clic) y vuelve a «Nuevo» si estaba
  // en «No le interesa»: ahora sí le interesa.
  const [row] = await prisma.$queryRaw<{ id: string; offered_via: string | null; inserted: boolean }[]>`
    INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, updated_at)
    VALUES (${randomUUID()}, ${edition.id}, ${conversationId}, ${PAGE_REGISTRATION_MESSAGE}, ${now}, ${now}, 1, 'nuevo', NOW())
    ON CONFLICT (edition_id, conversation_id) DO UPDATE
      SET asks = workshop_interests.asks + CASE WHEN workshop_interests.last_asked_at < EXCLUDED.last_asked_at - INTERVAL '10 minutes' THEN 1 ELSE 0 END,
          last_asked_at = GREATEST(workshop_interests.last_asked_at, EXCLUDED.last_asked_at),
          status = CASE WHEN workshop_interests.status = 'descartada' THEN 'nuevo' ELSE workshop_interests.status END,
          updated_at = NOW()
    RETURNING id, offered_via, (xmax = 0) AS inserted`;
  const alreadyRegistered = !row.inserted && (row.offered_via ?? "").startsWith("pagina:");
  // La nota, solo la primera vez (un registro repetido no llena las notas).
  if (!alreadyRegistered) {
    const stamp = now.toLocaleDateString("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" });
    await appendNote(contactId, `[${stamp}] Se registró en la página del taller «${edition.title}».`).catch(() => undefined);
  }
  return { status: "registered", contactId, conversationId, interestId: row.id, phoneE164, alreadyRegistered, firstName };
};

// ── 2. El WhatsApp ──────────────────────────────────────────────────────────

/**
 * Cada plantilla automática del registro deja una fila en la auditoría con la
 * huella de la conexión: es el presupuesto por conexión y el tope por hora y
 * día (índices por entidad y por fecha). Sin migración.
 */
export const IP_BUDGET_ENTITY = "WorkshopRegistrationIp";

export type RegistrationSendResult =
  | { status: "sent"; via: "text" | "template" }
  | { status: "skipped"; state: Exclude<RegistrationState, "text" | "template" | "enviando"> | "already" }
  | { status: "failed"; error: string };

type Deps = {
  send?: typeof sendMetaMessage;
  now?: Date;
  /** Tope de plantillas (las pruebas lo bajan). */
  cap?: { perHour: number; perDay: number };
  /** Plantillas por conexión al día (las pruebas lo bajan o suben). */
  perIp?: number;
  /** Mandar la plantilla a aprobar (en las pruebas, nada: no se llama a 360dialog). */
  ensureTemplates?: (keys: string[]) => Promise<unknown>;
};

/**
 * Las plantillas automáticas del registro reservadas desde `since` (todas las
 * ediciones: es lo que se paga). Se cuentan por sus reservas en la auditoría:
 * ni los textos dentro de las 24 h ni lo que manda el equipo («Que la IA le
 * escriba») cuentan.
 */
const templatesSince = (since: Date): Promise<number> =>
  prisma.auditLog.count({ where: { entityType: IP_BUDGET_ENTITY, createdAt: { gte: since } } });

/** La conexión, sin guardar la IP: una huella con la clave del sitio. */
export const registrationIpKey = (ip: string | null | undefined): string =>
  createHmac("sha256", process.env.AUTH_SECRET?.trim() || "taller-registro")
    .update(`taller-registro:${(ip ?? "").trim() || "desconocida"}`)
    .digest("hex")
    .slice(0, 40);


/**
 * Reserva una plantilla para esta conexión: se apunta primero y luego se
 * cuenta, así dos registros a la vez no pasan los dos. Devuelve false (y
 * borra la reserva) si ya no queda.
 */
const reserveIpBudget = async (ip: string | null, perIp: number, ref: { editionId: string; interestId: string }, now: Date): Promise<boolean> => {
  const key = registrationIpKey(ip);
  const mine = await prisma.auditLog.create({
    data: { action: "WORKSHOP_REGISTRATION_TEMPLATE", entityType: IP_BUDGET_ENTITY, entityId: key, changes: ref },
    select: { id: true },
  });
  const used = await prisma.auditLog.count({
    where: { entityType: IP_BUDGET_ENTITY, entityId: key, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
  });
  if (used <= perIp) return true;
  await prisma.auditLog.delete({ where: { id: mine.id } }).catch(() => undefined);
  return false;
};

const isRealPhone = (thread: string) => /^\d{8,15}$/.test(thread);

export const sendWorkshopRegistrationWhatsApp = async (
  input: { editionId: string; interestId: string; contactId: string; firstName: string | null; ip?: string | null },
  deps: Deps = {}
): Promise<RegistrationSendResult> => {
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendMetaMessage;
  const [row] = await prisma.$queryRaw<{ id: string; conversation_id: string; offered_via: string | null }[]>`
    SELECT id, conversation_id, offered_via FROM workshop_interests WHERE id = ${input.interestId} AND edition_id = ${input.editionId}`;
  if (!row) return { status: "failed", error: "La fila de interesadas no existe." };
  // Ya salió, se está enviando o tiene un motivo definitivo: no otra vez.
  if (!registrationClaimable(row.offered_via)) return { status: "skipped", state: "already" };

  const claimable = Prisma.sql`(offered_via IS NULL OR offered_via NOT LIKE 'pagina:%' OR offered_via IN (${Prisma.join(RETRYABLE_STATES.map(pageVia))}))`;
  /** Anota cómo quedó, solo si nadie la reclamó entre medias. */
  const stamp = async (state: Exclude<RegistrationState, "text" | "template" | "enviando">): Promise<RegistrationSendResult> => {
    const n = await prisma.$executeRaw`
      UPDATE workshop_interests SET offered_via = ${pageVia(state)}, updated_at = NOW() WHERE id = ${row.id} AND ${claimable}`;
    return n > 0 ? { status: "skipped", state } : { status: "skipped", state: "already" };
  };
  const finish = (state: RegistrationState) =>
    prisma.$executeRaw`UPDATE workshop_interests SET offered_via = ${pageVia(state)}, updated_at = NOW() WHERE id = ${row.id}`.catch(
      (e: unknown) => console.warn("[taller-registro] no se anotó el estado", state, e)
    );

  const edition = await loadEditionById(input.editionId, now);
  if (!edition?.open) return stamp("cerrado");
  const conv = await loadOutreachConversation(row.conversation_id);
  if (!conv || conv.channel !== "WHATSAPP") return stamp("fallo");

  // Todos los contactos de ese número (en cualquiera de sus formas) y los del registro y el chat:
  // la baja, la clienta o el pago de uno cuenta para todos (revisión 28-oct).
  const phoneOwners = isRealPhone(conv.externalThreadId)
    ? await prisma.contact.findMany({ where: { phoneE164: { in: contactPhoneCandidates(conv.externalThreadId) } }, select: { id: true } })
    : [];
  const contactIds = [...new Set([input.contactId, conv.contactId, ...phoneOwners.map((c) => c.id)].filter((x): x is string => Boolean(x)))];
  const [contacts, ignoredNumber, seg, config, contactedToday, paid, client] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { notifyWhatsapp: true } }),
    isIgnoredNumber(conv.externalThreadId),
    computeSegment(conv.id).catch(() => null),
    getWhatsAppAiConfig(),
    prisma.conversationMessage.count({
      where: {
        conversationId: conv.id,
        direction: "OUTBOUND",
        source: workshopOutreachSource(edition),
        status: { not: "FAILED" },
        sentAt: { gte: new Date(now.getTime() - 24 * 3600_000) },
      },
    }),
    paidAny(contactIds, edition.id),
    clientAny(contactIds),
  ]);
  const [refusal, aiOff] = await Promise.all([
    seg ? outreachRefusal(conv, { editionId: edition.id, config, now, seg, pastClientsOk: false }) : Promise.resolve(null),
    outreachAiOff(config),
  ]);
  const skip =
    registrationSkip({
      optedOut: contacts.some((c) => c.notifyWhatsapp === false),
      phoneOk: isRealPhone(conv.externalThreadId),
      paid: paid || refusal?.reason === "paid",
      ignoredNumber,
      segment: client ? "client" : (seg?.segment ?? null),
      stage: seg?.stage ?? null,
      segmentReview: seg?.review ?? false,
      category: conv.category,
      categorySource: conv.categorySource,
      aiOff: Boolean(aiOff),
      aiBlocked: refusal?.reason === "assigned" || refusal?.reason === "blocked",
      hasUpcomingCall: refusal?.reason === "has_call",
      contactedToday: contactedToday > 0,
    }) ??
    // Sin su estado al día no se sabe si es clienta, por revisar o personal; y lo
    // que el guardián dice sin decir qué («por revisar, clienta o personal»): no sale.
    (!seg || refusal ? "revisar" : null);
  if (skip) return stamp(skip);

  const source = workshopOutreachSource(edition);
  const clientKey = registrationClientKey(edition.id, conv.id);
  const windowOpen = resolveWindow("WHATSAPP", conv.lastInboundAt, now).isOpen;
  let template: Awaited<ReturnType<typeof approvedTemplateFor>> = null;
  if (!windowOpen) {
    // La plantilla habla del enlace de pago: sin precio no hay plantilla que sirva.
    if (!edition.payUrl) return stamp("sin_precio");
    // Solo a los países de su público: un número de otro lado es más probable que sea ajeno.
    if (!templateCountryAllowed(parsePhoneNumberFromString(`+${conv.externalThreadId}`)?.country)) return stamp("pais");
    template = await approvedTemplateFor(REGISTRATION_TEMPLATE_KEY);
    if (!template?.metaTemplateName) {
      const r = await stamp("plantilla");
      // Nunca se mandó a aprobar (o Meta la rechazó): se manda sola, como mucho cada 30 min.
      await (deps.ensureTemplates ?? ensureTemplatesSubmitted)([REGISTRATION_TEMPLATE_KEY]).catch(() => undefined);
      return r;
    }
    // Se pidió de Utilidad (dueña, 28-oct: «que no sea de marketing ya que la
    // persona aceptó»); si Meta la aprobó como Marketing, no sale sola como
    // marketing: queda dicho en «Interesadas» y Dayana decide.
    if ((template.metaCategory ?? "").toUpperCase() !== "UTILITY") return stamp("marketing");
    // Topes de plantillas (freno de gasto: dos a la vez pueden pasarlo por una).
    const cap = deps.cap ?? WORKSHOP_REGISTRATION_TEMPLATE_CAP;
    const [lastHour, lastDay] = await Promise.all([
      templatesSince(new Date(now.getTime() - 3600_000)),
      templatesSince(new Date(now.getTime() - 24 * 3600_000)),
    ]);
    if (confirmationCapReason({ lastHour, lastDay }, cap)) return stamp("tope");
    const perIp = deps.perIp ?? REGISTRATION_TEMPLATES_PER_IP_PER_DAY;
    if (!(await reserveIpBudget(input.ip ?? null, perIp, { editionId: edition.id, interestId: row.id }, now))) return stamp("ip");
  }

  // Reclamo: una vez por persona y edición.
  const claimed = await prisma.$executeRaw`
    UPDATE workshop_interests SET offered_via = ${pageVia("enviando")}, updated_at = NOW() WHERE id = ${row.id} AND ${claimable}`;
  if (claimed === 0) return { status: "skipped", state: "already" };

  try {
    let via: "text" | "template";
    if (!template) {
      await send({
        conversationId: conv.id,
        body: workshopRegistrationText(edition, { firstName: input.firstName }),
        source,
        isAutoReply: true,
        clientKey,
      });
      via = "text";
    } else {
      const vars = workshopRegistrationTemplateVars(edition, { firstName: input.firstName });
      await send({
        conversationId: conv.id,
        body: fillVars(template.body, vars),
        template: {
          name: template.metaTemplateName!,
          language: template.metaTemplateLang ?? "es",
          variables: templateParams(template.metaVarNames, vars),
        },
        source,
        isAutoReply: true,
        clientKey,
      });
      via = "template";
    }
    // Ya salió: si no se anota, queda en el chat igual (y la fila lo lee por su clave).
    await prisma.$executeRaw`
      UPDATE workshop_interests
      SET offered_at = ${now}, offered_via = ${pageVia(via)},
          status = CASE WHEN status = 'nuevo' THEN 'contactada' ELSE status END,
          updated_at = NOW()
      WHERE id = ${row.id}`.catch((e: unknown) => console.warn("[taller-registro] no se anotó el envío", e));
    return { status: "sent", via };
  } catch (e) {
    // La ventana se cerró entre medias: queda para reintentar, como sin la plantilla.
    if (e instanceof MetaWindowError) {
      await finish("plantilla");
      return { status: "skipped", state: "plantilla" };
    }
    await finish("fallo");
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
};
