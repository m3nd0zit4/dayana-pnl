import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { contactPhoneCandidates, isWhatsAppUserId } from "@/lib/whatsapp-contact";
import { writeAuditLog } from "./audit";
import { aiErrorKind, classifyWithAi, type AiErrorKind } from "./chat-category-ai";
import {
  CHAT_CATEGORIES,
  REVIEW_BELOW_SILENT,
  SILENT_CATEGORIES,
  classifyByRules,
  crmVerdict,
  isSilencingCategory,
  isSilentCategory,
  isTeamThread,
  needsReview,
  normalizeTeamPhone,
  parseTeamPhones,
  phoneDigitVariants,
  signalHints,
  type CategoryMessage,
  type CategorySignals,
  type ChatCategory,
  type ChatFacts,
} from "./chat-category-rules";
import { getSiteSetting, getSiteSettingBoolean, setSiteSetting, setSiteSettingBoolean } from "./site-settings";
import { effectiveAiMode, type AiMode } from "./whatsapp-agent/mode";
import { getWhatsAppAiConfig } from "./whatsapp-ai-config";

/**
 * Clasificación de los chats de WhatsApp: carga lo que sabe el CRM de cada
 * chat, aplica las reglas (chat-category-rules.ts) y, si no deciden, pregunta
 * al modelo (chat-category-ai.ts). Lo marcado a mano nunca se pisa.
 *
 * - Apagada por defecto (`whatsapp.classify_enabled`): la enciende la dueña
 *   después de ver la vista previa. Apagada, nada corre solo y nada va a la
 *   IA; «Clasificar todo» aplica solo las reglas.
 * - Los chats en modo Manual (Dayana los lleva) nunca van a la IA.
 * - Un chat se vuelve a mirar cuando tiene mensajes nuevos desde la última
 *   vez (`categorizedThroughAt < lastMessageAt`). Si la última decisión fue de
 *   la IA y la persona no escribió nada nuevo, se conserva sin volver a
 *   llamarla. Lo que cambia en el CRM (pagó, agendó…) lo recoge
 *   `refreshCrmCategories` en cada vuelta del reloj.
 */

export const TEAM_PHONES_KEY = "whatsapp.team_phones";
export const CLASSIFY_ENABLED_KEY = "whatsapp.classify_enabled";
/** Una sola tanda a la vez (reloj y «Clasificar todo»): arriendo con caducidad. */
const CLASSIFY_LOCK_KEY = "whatsapp.classify_lock";
const LOCK_TTL_MS = 3 * 60_000;

/** Mensajes que leen las reglas (la IA usa los últimos 30 de estos). */
const RULE_MESSAGES = 60;
/** Fallos seguidos de la IA (no de cuota ni de clave) que cortan la IA en esa vuelta. */
const MAX_CONSECUTIVE_AI_FAILURES = 3;
/** No se empieza una llamada a la IA con menos tiempo que esto. */
const MIN_AI_CALL_MS = 3_000;

const hasModelKey = () => Boolean(process.env.GEMINI_API_KEY?.trim());

// ── Ajustes ───────────────────────────────────────────────────────────────

export const getTeamPhones = async (): Promise<string[]> => parseTeamPhones(await getSiteSetting(TEAM_PHONES_KEY));

/** Encendida solo si la dueña la encendió (`true`). Por defecto, apagada. */
export const isClassifyEnabled = async (): Promise<boolean> =>
  (await getSiteSettingBoolean(CLASSIFY_ENABLED_KEY)) === true;

export const setClassifyEnabled = async (enabled: boolean, staffId: string | null) => {
  const prev = await isClassifyEnabled();
  await setSiteSettingBoolean(CLASSIFY_ENABLED_KEY, enabled);
  await writeAuditLog({
    staffUserId: staffId ?? undefined,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: CLASSIFY_ENABLED_KEY,
    changes: { from: prev, to: enabled },
  });
  return enabled;
};

type RunContext = { teamPhones: string[]; generalMode: AiMode; aiEnabled: boolean };

const loadRunContext = async (): Promise<RunContext> => {
  const [teamPhones, config, enabled] = await Promise.all([getTeamPhones(), getWhatsAppAiConfig(), isClassifyEnabled()]);
  return { teamPhones, generalMode: config.defaultMode, aiEnabled: enabled && hasModelKey() };
};

// ── Carga ─────────────────────────────────────────────────────────────────

const CONVERSATION_SELECT = {
  id: true,
  channel: true,
  externalThreadId: true,
  contactId: true,
  participantName: true,
  lastMessageAt: true,
  lastInboundAt: true,
  aiMode: true,
} as const;

/** Lo mínimo de un chat para clasificarlo (sin las columnas de la clasificación). */
export type ConversationBase = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

type ClassificationState = {
  category: string | null;
  categorySource: string | null;
  categoryConfidence: number | null;
  categoryReason: string | null;
  categoryReview: boolean;
  categorizedThroughAt: Date | null;
};

const STATE_SELECT = {
  category: true,
  categorySource: true,
  categoryConfidence: true,
  categoryReason: true,
  categoryReview: true,
  categorizedThroughAt: true,
} as const;

type FullConversation = ConversationBase & ClassificationState;

export type LoadedFacts = ChatFacts & {
  /** Orden cronológico (lo más viejo primero), para el modelo. */
  messages: CategoryMessage[];
};

type MessageRow = {
  conversation_id: string;
  direction: string;
  body: string | null;
  kind: string;
  is_echo: boolean;
  is_auto_reply: boolean;
  source: string | null;
  attachments: unknown;
  sent_at: Date;
};

const phonesOf = (threadId: string): { e164: string[]; digits: string[] } => {
  if (isWhatsAppUserId(threadId)) return { e164: [], digits: [] };
  const e164 = contactPhoneCandidates(threadId);
  return { e164, digits: e164.map((p) => p.replace(/\D/g, "")) };
};

/** «3/8» con paquete; «0/0» o sin contador es la consulta gratis. */
const isPackageSession = (label: string | null): boolean => {
  const m = label?.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  return Boolean(m && Number(m[2]) > 0);
};

/** Los últimos 60 mensajes de cada chat: una consulta, con el índice (conversation_id, sent_at). */
const loadMessages = async (ids: string[]): Promise<Map<string, CategoryMessage[]>> => {
  const rows = await prisma.$queryRaw<MessageRow[]>(Prisma.sql`
    SELECT c.id AS conversation_id, m.direction::text AS direction, m.body, m.kind, m.is_echo,
           m.is_auto_reply, m.source, m.attachments, m.sent_at
    FROM (VALUES ${Prisma.join(ids.map((id) => Prisma.sql`(${id}::text)`))}) AS c(id)
    CROSS JOIN LATERAL (
      SELECT direction, body, kind, is_echo, is_auto_reply, source, attachments, sent_at
      FROM conversation_messages
      WHERE conversation_id = c.id
      ORDER BY sent_at DESC
      LIMIT ${RULE_MESSAGES}
    ) m
    ORDER BY m.sent_at ASC`);
  const out = new Map<string, CategoryMessage[]>();
  for (const r of rows) {
    const list = out.get(r.conversation_id) ?? [];
    list.push({
      direction: r.direction,
      body: r.body,
      kind: r.kind,
      isEcho: r.is_echo,
      isAutoReply: r.is_auto_reply,
      source: r.source,
      attachments: r.attachments,
    });
    out.set(r.conversation_id, list);
  }
  return out;
};

/**
 * Señales del CRM (y, si se piden, los últimos mensajes) de varios chats a la
 * vez: una consulta por tabla, no una por chat. Solo lee: sirve también para
 * la vista previa contra una base sin la migración.
 */
export const loadFactsBatch = async (
  conversations: Pick<ConversationBase, "id" | "externalThreadId" | "contactId" | "participantName" | "lastInboundAt">[],
  teamPhones: string[],
  opts: { messages?: boolean } = {}
): Promise<Map<string, LoadedFacts>> => {
  const out = new Map<string, LoadedFacts>();
  if (conversations.length === 0) return out;

  const ids = conversations.map((c) => c.id);
  const phones = new Map(conversations.map((c) => [c.id, phonesOf(c.externalThreadId)]));
  const allE164 = [...new Set([...phones.values()].flatMap((p) => p.e164))];
  const allDigits = [...new Set([...phones.values()].flatMap((p) => p.digits))];

  // Contactos ligados al chat y, por si no están ligados, los de su número.
  const byPhone = allE164.length
    ? await prisma.contact.findMany({ where: { phoneE164: { in: allE164 } }, select: { id: true, phoneE164: true } })
    : [];
  const contactIdsOf = new Map<string, string[]>();
  for (const c of conversations) {
    const own = phones.get(c.id)!.e164;
    const list = new Set<string>(c.contactId ? [c.contactId] : []);
    for (const p of byPhone) if (own.includes(p.phoneE164)) list.add(p.id);
    contactIdsOf.set(c.id, [...list]);
  }
  const contactIds = [...new Set([...contactIdsOf.values()].flat())];
  const inContacts = { in: contactIds };
  const phoneForms = [...allDigits, ...allE164];

  const [enrollments, diagnostics, registrations, bookings, appointments, known, communities, messages] =
    await Promise.all([
      contactIds.length
        ? prisma.enrollment.findMany({
            where: { contactId: inContacts },
            select: {
              contactId: true,
              status: true,
              amountMinor: true,
              product: { select: { kind: true } },
              payments: { where: { status: "APPROVED" }, select: { id: true }, take: 1 },
            },
          })
        : [],
      prisma.diagnostic.findMany({
        where: { OR: [{ contactId: inContacts }, { outreachConversationId: { in: ids } }] },
        select: { contactId: true, outreachConversationId: true },
      }),
      contactIds.length
        ? prisma.webinarRegistration.findMany({ where: { contactId: inContacts }, select: { contactId: true } })
        : [],
      prisma.whatsAppBooking.findMany({
        where: {
          OR: [{ conversationId: { in: ids } }, { contactId: inContacts }, { phone: { in: phoneForms } }],
        },
        select: { conversationId: true, contactId: true, phone: true },
      }),
      prisma.calendarAppointment.findMany({
        where: {
          OR: [{ conversationId: { in: ids } }, { contactId: inContacts }, { phone: { in: phoneForms } }],
        },
        select: { conversationId: true, contactId: true, phone: true, sessionsLabel: true },
      }),
      allDigits.length
        ? prisma.whatsAppKnownContact.findMany({
            where: { phone: { in: allDigits }, removedAt: null },
            select: { phone: true },
          })
        : [],
      contactIds.length
        ? prisma.whatsAppCommunityMember.findMany({
            where: { contactId: inContacts, status: { in: ["JOINED", "INVITED"] } },
            select: { contactId: true },
          })
        : [],
      opts.messages === false ? Promise.resolve(new Map<string, CategoryMessage[]>()) : loadMessages(ids),
    ]);

  const knownPhones = new Set(known.map((k) => k.phone));

  for (const c of conversations) {
    const cids = new Set(contactIdsOf.get(c.id));
    const { e164, digits } = phones.get(c.id)!;
    const forms = new Set([...e164, ...digits]);
    const mine = <T extends { contactId: string | null }>(rows: T[]) => rows.filter((r) => r.contactId && cids.has(r.contactId));
    const ownEnrollments = mine(enrollments);
    const active = ownEnrollments.filter((e) => e.status === "ACTIVE" || e.status === "COMPLETED");
    // Un importe nulo (a mano, gratis) no es «pagó»: lo dice un pago aprobado.
    const paid = active.find((e) => (e.amountMinor ?? 0) > 0);
    const approved = ownEnrollments.some((e) => e.payments.length > 0);
    const linked = <T extends { conversationId: string | null; contactId: string | null; phone: string | null }>(rows: T[]) =>
      rows.filter(
        (r) =>
          r.conversationId === c.id ||
          (r.contactId && cids.has(r.contactId)) ||
          (r.phone && (forms.has(r.phone) || forms.has(`+${r.phone.replace(/\D/g, "")}`)))
      );
    const ownAppointments = linked(appointments);

    const signals: CategorySignals = {
      isTeamPhone: isTeamThread(c.externalThreadId, teamPhones),
      hasPaidEnrollment: Boolean(paid),
      paidKind: paid?.product.kind ?? null,
      hasApprovedPayment: approved,
      hasUnpaidActiveEnrollment: active.length > 0 && !paid && !approved,
      hasTherapySession: ownAppointments.some((a) => isPackageSession(a.sessionsLabel)),
      hasLeadEnrollment: ownEnrollments.some((e) => e.status === "LEAD"),
      hasPendingPayment: ownEnrollments.some((e) => e.status === "PENDING_PAYMENT"),
      hasDiagnostic: diagnostics.some((d) => d.outreachConversationId === c.id || (d.contactId && cids.has(d.contactId))),
      hasBooking:
        linked(bookings).length > 0 || ownAppointments.some((a) => !isPackageSession(a.sessionsLabel)),
      hasWebinarRegistration: mine(registrations).length > 0,
      communityMember: mine(communities).length > 0,
      inAddressBook: digits.some((d) => knownPhones.has(d)),
    };
    out.set(c.id, {
      signals,
      messages: messages.get(c.id) ?? [],
      participantName: c.participantName,
      everWrote: c.lastInboundAt !== null,
    });
  }
  return out;
};

// ── Guardar ───────────────────────────────────────────────────────────────

export type ClassifyOutcome =
  | { id: string; status: "skipped"; reason: "not_found" | "manual" | "up_to_date" | "needs_ai" | "stale" }
  | {
      id: string;
      status: "classified";
      category: ChatCategory;
      source: "rule" | "ai";
      confidence: number;
      reason: string;
      review: boolean;
      /** La IA ya lo había decidido y la persona no escribió nada nuevo: no se le volvió a preguntar. */
      kept?: boolean;
      model?: string;
      latencyMs?: number;
      inputTokens?: number | null;
      outputTokens?: number | null;
    }
  | { id: string; status: "error"; error: string; kind: AiErrorKind };

/** Nunca escribe sobre una clasificación manual, aunque se haya puesto mientras tanto. */
const notManual = { OR: [{ categorySource: null }, { categorySource: { not: "manual" } }] };

type Verdict = { category: ChatCategory; source: "rule" | "ai"; confidence: number; reason: string; review: boolean };

/**
 * Guarda si no es manual y nadie guardó algo más nuevo mientras tanto (otra
 * tanda que ya vio un mensaje posterior). `false` si no se guardó.
 */
const save = async (id: string, through: Date, v: Verdict): Promise<boolean> => {
  const r = await prisma.conversation.updateMany({
    where: {
      id,
      AND: [notManual, { OR: [{ categorizedThroughAt: null }, { categorizedThroughAt: { lte: through } }] }],
    },
    data: {
      category: v.category,
      categorySource: v.source,
      categoryConfidence: v.confidence,
      categoryReason: v.reason.slice(0, 200),
      categoryReview: v.review,
      categorizedAt: new Date(),
      categorizedThroughAt: through,
    },
  });
  return r.count > 0;
};

const savedOrSkipped = async (c: FullConversation, v: Verdict, extra: Partial<Extract<ClassifyOutcome, { status: "classified" }>> = {}) =>
  (await save(c.id, c.lastMessageAt, v))
    ? ({ id: c.id, status: "classified", ...v, ...extra } as ClassifyOutcome)
    : ({ id: c.id, status: "skipped", reason: c.categorySource === "manual" ? "manual" : "stale" } as ClassifyOutcome);

/** El modelo no pudo devolver una categoría (bloqueo de seguridad, JSON roto): nunca se silencia. */
const NO_OBJECT_VERDICT: Verdict = {
  category: "interesada",
  source: "ai",
  confidence: 0.5,
  reason: "La IA no pudo decidir: revisar",
  review: true,
};

type AiClassifier = typeof classifyWithAi;

/**
 * Paso de reglas de un chat: guarda si las reglas deciden o si se conserva lo
 * que dijo la IA. Devuelve `null` si hace falta la IA.
 */
const rulesStep = async (c: FullConversation, facts: LoadedFacts, force: boolean): Promise<ClassifyOutcome | null> => {
  if (c.categorySource === "manual") return { id: c.id, status: "skipped", reason: "manual" };
  if (!force && c.categorizedThroughAt && c.categorizedThroughAt.getTime() >= c.lastMessageAt.getTime()) {
    return { id: c.id, status: "skipped", reason: "up_to_date" };
  }
  const rule = classifyByRules(facts);
  if (rule) return savedOrSkipped(c, { ...rule, source: "rule", review: needsReview(rule.category, rule.confidence) });

  // La IA ya habló y la persona no escribió nada desde entonces (solo
  // mensajes nuestros): se conserva sin pagar otra llamada.
  const lastInbound = c.lastInboundAt?.getTime() ?? 0;
  if (
    !force &&
    c.categorySource === "ai" &&
    c.category &&
    c.categorizedThroughAt &&
    c.categorizedThroughAt.getTime() >= lastInbound
  ) {
    const kept: Verdict = {
      category: c.category as ChatCategory,
      source: "ai",
      confidence: c.categoryConfidence ?? 0,
      reason: c.categoryReason ?? "",
      review: c.categoryReview,
    };
    return savedOrSkipped(c, kept, { kept: true });
  }
  return null;
};

/** Paso de IA de un chat (las reglas no decidieron). Lanza si la IA falla, salvo «sin categoría». */
const aiStep = async (
  c: FullConversation,
  facts: LoadedFacts,
  classifier: AiClassifier,
  deadline?: number
): Promise<ClassifyOutcome> => {
  try {
    const ai = await classifier({ messages: facts.messages, hints: signalHints(facts), deadline });
    return savedOrSkipped(
      c,
      { category: ai.category, source: "ai", confidence: ai.confidence, reason: ai.reason, review: ai.review },
      { model: ai.model, latencyMs: ai.latencyMs, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens }
    );
  } catch (e) {
    if (aiErrorKind(e) === "no_object") return savedOrSkipped(c, NO_OBJECT_VERDICT);
    throw e;
  }
};

const errorOutcome = (id: string, e: unknown): ClassifyOutcome => ({
  id,
  status: "error",
  error: e instanceof Error ? e.message.slice(0, 200) : String(e),
  kind: aiErrorKind(e),
});

/** ¿Este chat puede ir a la IA? No si Dayana lo lleva a mano (modo Manual). */
const aiAllowedFor = (c: Pick<ConversationBase, "aiMode">, ctx: RunContext) =>
  ctx.aiEnabled && effectiveAiMode(c.aiMode, ctx.generalMode) !== "MANUAL";

const loadConversation = (id: string) =>
  prisma.conversation.findFirst({
    where: { id, channel: "WHATSAPP" },
    select: { ...CONVERSATION_SELECT, ...STATE_SELECT },
  });

/**
 * Clasifica un chat. `force` lo vuelve a mirar aunque no tenga mensajes
 * nuevos (y vuelve a preguntar a la IA), pero nunca pisa lo manual.
 * `useAi: false`: solo reglas. La IA además exige la clasificación encendida
 * y que el chat no esté en modo Manual. `deadline` (epoch ms): la hora a la
 * que la IA tiene que haber terminado aunque falle (la llamada se corta).
 */
export const classifyConversation = async (
  id: string,
  opts: { force?: boolean; useAi?: boolean; classifier?: AiClassifier; deadline?: number } = {}
): Promise<ClassifyOutcome> => {
  const c = await loadConversation(id);
  if (!c) return { id, status: "skipped", reason: "not_found" };
  if (c.categorySource === "manual") return { id, status: "skipped", reason: "manual" };
  const ctx = await loadRunContext();
  const facts = (await loadFactsBatch([c], ctx.teamPhones)).get(id)!;
  const ruled = await rulesStep(c, facts, Boolean(opts.force));
  if (ruled) return ruled;
  if (opts.useAi === false || !aiAllowedFor(c, ctx)) return { id, status: "skipped", reason: "needs_ai" };
  try {
    return await aiStep(c, facts, opts.classifier ?? classifyWithAi, opts.deadline);
  } catch (e) {
    return errorOutcome(id, e);
  }
};

/** Deja la etiqueta automática sin efecto: el chat queda pendiente para la próxima vuelta. */
const CLEARED = {
  category: null,
  categorySource: null,
  categoryConfidence: null,
  categoryReason: null,
  categoryReview: false,
  categorizedThroughAt: null,
} as const;

/**
 * Antes de callar en un chat (fase B2): vuelve a pasar las reglas, sin IA y
 * sin esperar a la próxima vuelta del reloj, por si cambió algo en el CRM
 * (pagó, agendó, hizo la autoevaluación) o la persona escribió algo nuevo.
 * Devuelve el estado con el que hay que decidir y si de verdad silencia:
 *
 * - clasificación apagada → nunca silencia (la etiqueta se queda);
 * - manual → manda lo manual;
 * - las reglas deciden → se guarda y manda eso;
 * - las reglas ya no deciden y la etiqueta era de una regla → era vieja: se
 *   borra (queda pendiente) y no silencia;
 * - la etiqueta es de la IA pero la persona escribió después → no silencia
 *   hasta que la IA lo vuelva a mirar (ya está en la cola de pendientes).
 */
export const reclassifyByRulesNow = async (conversationId: string) => {
  const c = await loadConversation(conversationId);
  if (!c) return null;
  const enabled = await isClassifyEnabled();
  let stale = false;
  if (c.categorySource !== "manual") {
    const facts = (await loadFactsBatch([c], await getTeamPhones())).get(c.id)!;
    const rule = classifyByRules(facts);
    if (rule) {
      if (rule.category !== c.category || c.categorySource !== "rule" || rule.reason !== c.categoryReason) {
        await save(c.id, c.lastMessageAt, { ...rule, source: "rule", review: needsReview(rule.category, rule.confidence) });
      }
    } else if (c.categorySource === "rule" && isSilentCategory(c.category)) {
      await prisma.conversation.updateMany({ where: { id: c.id, categorySource: "rule" }, data: CLEARED });
    } else if (
      c.categorySource === "ai" &&
      c.lastInboundAt &&
      (!c.categorizedThroughAt || c.lastInboundAt.getTime() > c.categorizedThroughAt.getTime())
    ) {
      stale = true;
    }
  }
  const now = await prisma.conversation.findUniqueOrThrow({
    where: { id: c.id },
    select: { id: true, category: true, categorySource: true, categoryConfidence: true, categoryReview: true },
  });
  return { ...now, stale, silencing: !stale && isSilencingCategory(now, { enabled }) };
};

/**
 * Para las colas de B2 («Te toca», «Pendientes»): los chats que NO silencian,
 * el mismo criterio que `isSilencingCategory` en SQL y sin perder los nulos.
 * Apagada la clasificación, no excluye nada (`{}`).
 */
export const notSilencedWhere = (enabled: boolean): Prisma.ConversationWhereInput => {
  if (!enabled) return {};
  const silent = [...SILENT_CATEGORIES];
  const unsure: Prisma.ConversationWhereInput[] = [
    { categoryConfidence: null },
    { categoryConfidence: { lt: REVIEW_BELOW_SILENT } },
    { categoryReview: true },
  ];
  return {
    OR: [
      { category: null },
      { category: { notIn: silent } },
      { categorySource: null },
      { categorySource: { notIn: ["manual", "rule", "ai"] } },
      { categorySource: "rule", OR: [{ category: "personal" }, ...unsure] },
      { categorySource: "ai", OR: [{ category: "equipo" }, ...unsure] },
    ],
  };
};

/**
 * Algo cambió en el CRM de esta persona: sus chats se vuelven a mirar en la
 * próxima vuelta (no toca los manuales). Para llamarlo desde los pagos, citas,
 * autoevaluaciones e inscripciones (fase B2).
 */
export const markForReclassification = async (target: { conversationId?: string; contactId?: string; phone?: string }) => {
  const or: Prisma.ConversationWhereInput[] = [];
  if (target.conversationId) or.push({ id: target.conversationId });
  if (target.contactId) or.push({ contactId: target.contactId });
  if (target.phone) or.push({ externalThreadId: { in: phoneDigitVariants(target.phone) } });
  if (or.length === 0) return 0;
  const r = await prisma.conversation.updateMany({
    where: { channel: "WHATSAPP", AND: [notManual, { OR: or }] },
    data: { categorizedThroughAt: null },
  });
  return r.count;
};

// ── Tandas ────────────────────────────────────────────────────────────────

/** Chats de WhatsApp sin clasificar o con mensajes nuevos desde la última vez (sin los manuales). */
export const pendingClassificationWhere = (): Prisma.ConversationWhereInput => ({
  channel: "WHATSAPP",
  AND: [
    notManual,
    {
      OR: [
        { categorizedThroughAt: null },
        { categorizedThroughAt: { lt: prisma.conversation.fields.lastMessageAt } },
      ],
    },
  ],
});

/** Por qué se dejó de llamar a la IA en una vuelta. */
export type AiStop = "billing" | "auth" | "rate" | "errors";

export type ClassifyRunResult = {
  processed: number;
  classified: number;
  byRule: number;
  byAi: number;
  /** Se conservó lo que había dicho la IA (sin mensajes nuevos de la persona). */
  kept: number;
  review: number;
  /** Dudosos que esperan a la IA (apagada, sin clave, chat Manual o IA cortada). */
  needsAi: number;
  failed: number;
  skipped: number;
  /** Pendientes que quedan después de esta tanda. */
  remaining: number;
  models: string[];
  /** La IA se cortó en esta vuelta (facturación, clave, cuota o fallos seguidos). */
  aiBlocked: AiStop | null;
  /** La IA no se usó: clasificación apagada o sin clave. */
  aiDisabled: boolean;
  /**
   * Otra tanda estaba corriendo: esta no hizo nada. Quien llama (la pantalla)
   * tiene que esperar `retryAfterMs` antes de volver a intentar, no insistir.
   */
  busy: boolean;
  retryAfterMs?: number;
  ms: number;
  errors: string[];
};

/** Cuánto esperar si otra tanda tiene el arriendo (una tanda dura ≤ ~50 s). */
export const BUSY_RETRY_AFTER_MS = 15_000;

const emptyResult = (): ClassifyRunResult => ({
  processed: 0,
  classified: 0,
  byRule: 0,
  byAi: 0,
  kept: 0,
  review: 0,
  needsAi: 0,
  failed: 0,
  skipped: 0,
  remaining: 0,
  models: [],
  aiBlocked: null,
  aiDisabled: false,
  busy: false,
  ms: 0,
  errors: [],
});

const tally = (result: ClassifyRunResult, outcome: ClassifyOutcome) => {
  result.processed++;
  if (outcome.status === "classified") {
    result.classified++;
    if (outcome.kept) result.kept++;
    else if (outcome.source === "rule") result.byRule++;
    else result.byAi++;
    if (outcome.review) result.review++;
    if (outcome.model && !result.models.includes(outcome.model)) result.models.push(outcome.model);
  } else if (outcome.status === "error") {
    result.failed++;
    if (result.errors.length < 5) result.errors.push(outcome.error);
  } else if (outcome.reason === "needs_ai") {
    result.needsAi++;
  } else {
    result.skipped++;
  }
};

/**
 * El arriendo de la tanda (exportado para las pruebas). `null` si otra tanda
 * lo tiene. Con el reloj de la base (no el de cada servidor): caduca a los
 * 3 minutos por si quien lo tenía murió sin soltarlo.
 */
export const acquireClassifyLock = async (): Promise<string | null> => {
  const token = `${Date.now()}#${Math.random().toString(36).slice(2, 10)}`;
  const ttlSeconds = Math.round(LOCK_TTL_MS / 1000);
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO site_settings (key, value, updated_at)
    VALUES (${CLASSIFY_LOCK_KEY}, ${token}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = (now() AT TIME ZONE 'UTC')
    WHERE site_settings.updated_at < (now() AT TIME ZONE 'UTC') - (${ttlSeconds}::int * interval '1 second')
    RETURNING key`;
  return rows.length > 0 ? token : null;
};

export const releaseClassifyLock = (token: string) =>
  prisma.siteSetting.deleteMany({ where: { key: CLASSIFY_LOCK_KEY, value: token } }).catch(() => undefined);

/**
 * Una tanda, en dos pasos:
 * 1. Reglas para TODOS los pendientes (son baratas): ningún dudoso tapa a los
 *    que las reglas sí saben decidir.
 * 2. IA para hasta `limit` dudosos, lo más reciente primero, sin pasar de
 *    `budgetMs` (tampoco una llamada en curso: se le pasa la hora límite).
 *
 * La IA se corta en esa vuelta —el chat queda sin tocar y se avisa una vez—
 * con el 403 de facturación de Google, una clave inválida (401/403), cuota
 * (429) o 3 fallos seguidos. Si el modelo no devuelve categoría (bloqueo de
 * seguridad), el chat queda «interesada · revisar»: nunca callado.
 */
export const classifyPending = async (
  opts: {
    limit?: number;
    budgetMs?: number;
    useAi?: boolean;
    concurrency?: number;
    /** Solo estos chats (pruebas y scripts); sin arriendo. */
    ids?: string[];
    /** Quien llama ya tiene el arriendo (el reloj). */
    leaseHeld?: boolean;
    /** Solo pruebas: sustituye al modelo (p. ej. para simular el 403 de facturación). */
    classifier?: AiClassifier;
  } = {}
): Promise<ClassifyRunResult> => {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 40_000;
  const deadline = started + budgetMs;
  const result = emptyResult();

  const lock = opts.ids || opts.leaseHeld ? null : await acquireClassifyLock();
  if (!opts.ids && !opts.leaseHeld && !lock) {
    return { ...result, busy: true, retryAfterMs: BUSY_RETRY_AFTER_MS, ms: Date.now() - started };
  }

  try {
    const ctx = await loadRunContext();
    const aiWanted = opts.useAi ?? true;
    result.aiDisabled = aiWanted && !ctx.aiEnabled;
    const where: Prisma.ConversationWhereInput = opts.ids
      ? { AND: [pendingClassificationWhere(), { id: { in: opts.ids } }] }
      : pendingClassificationWhere();

    // 1. Reglas.
    const pending = await prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
      take: 500,
      select: { ...CONVERSATION_SELECT, ...STATE_SELECT },
    });
    const forAi: { c: FullConversation; facts: LoadedFacts }[] = [];
    for (let i = 0; i < pending.length && Date.now() < deadline; i += 100) {
      const chunk = pending.slice(i, i + 100);
      const facts = await loadFactsBatch(chunk, ctx.teamPhones);
      for (const c of chunk) {
        const f = facts.get(c.id)!;
        let outcome: ClassifyOutcome | null;
        try {
          outcome = await rulesStep(c, f, false);
        } catch (e) {
          outcome = errorOutcome(c.id, e);
        }
        if (outcome) tally(result, outcome);
        else if (aiWanted && aiAllowedFor(c, ctx)) forAi.push({ c, facts: f });
        else tally(result, { id: c.id, status: "skipped", reason: "needs_ai" });
      }
    }

    // 2. IA.
    const classifier = opts.classifier ?? classifyWithAi;
    const queue = forAi.slice(0, opts.limit ?? 40);
    result.needsAi += forAi.length - queue.length;
    let next = 0;
    let consecutive = 0;
    const stop = (why: AiStop) => {
      if (result.aiBlocked) return;
      result.aiBlocked = why;
      console.warn(
        `[clasificar] IA cortada en esta vuelta (${why === "billing" ? "Google la bloqueó por facturación (403)" : why}); los dudosos quedan pendientes.`
      );
    };
    const worker = async () => {
      while (next < queue.length) {
        const { c, facts } = queue[next++];
        if (result.aiBlocked || deadline - Date.now() < MIN_AI_CALL_MS) {
          tally(result, { id: c.id, status: "skipped", reason: "needs_ai" });
          continue;
        }
        let outcome: ClassifyOutcome;
        try {
          outcome = await aiStep(c, facts, classifier, deadline);
          consecutive = 0;
        } catch (e) {
          outcome = errorOutcome(c.id, e);
        }
        if (outcome.status === "error") {
          if (outcome.kind === "billing") {
            // No es un fallo del chat: queda pendiente para cuando se pague.
            stop("billing");
            tally(result, { id: c.id, status: "skipped", reason: "needs_ai" });
            continue;
          }
          if (outcome.kind === "auth" || outcome.kind === "rate") stop(outcome.kind);
          else if (++consecutive >= MAX_CONSECUTIVE_AI_FAILURES) stop("errors");
        }
        tally(result, outcome);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, worker));

    result.remaining = await prisma.conversation.count({ where });
  } finally {
    if (lock) await releaseClassifyLock(lock);
  }
  result.ms = Date.now() - started;
  return result;
};

/**
 * Lo que decide el CRM (equipo, cliente, interesada) vuelve a mirarse en
 * todos los chats, sin mensajes ni IA: quien pagó o agendó deja de estar en
 * «negocio» o «comunidad» aunque no haya escrito nada nuevo. Sin pasar de
 * `deadline` (epoch ms): lo que no alcance, en la próxima vuelta.
 */
export const refreshCrmCategories = async (opts: { ids?: string[]; deadline?: number } = {}) => {
  const rows = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", ...(opts.ids ? { id: { in: opts.ids } } : {}), AND: [notManual] },
    select: { ...CONVERSATION_SELECT, ...STATE_SELECT },
    orderBy: { lastMessageAt: "desc" },
  });
  const teamPhones = await getTeamPhones();
  let updated = 0;
  let checked = 0;
  for (let i = 0; i < rows.length; i += 200) {
    if (opts.deadline && Date.now() >= opts.deadline) break;
    const chunk = rows.slice(i, i + 200);
    checked += chunk.length;
    const facts = await loadFactsBatch(chunk, teamPhones, { messages: false });
    for (const c of chunk) {
      const v = crmVerdict(facts.get(c.id)!.signals);
      if (!v || (v.category === c.category && c.categorySource === "rule" && v.reason === c.categoryReason)) continue;
      const r = await prisma.conversation.updateMany({
        where: { id: c.id, AND: [notManual] },
        data: {
          category: v.category,
          categorySource: "rule",
          categoryConfidence: v.confidence,
          categoryReason: v.reason,
          categoryReview: needsReview(v.category, v.confidence),
          categorizedAt: new Date(),
        },
      });
      updated += r.count;
    }
  }
  return { checked, total: rows.length, updated };
};

/**
 * El paso del reloj de WhatsApp. Nada si la clasificación está apagada (por
 * defecto). Todo bajo un solo arriendo: si «Clasificar todo» está corriendo,
 * esta vuelta no hace nada.
 */
export const classifyFromCron = async (budgetMs: number) => {
  if (!(await isClassifyEnabled())) return { skipped: "disabled" as const };
  if (budgetMs < 5_000) return { skipped: "no_time" as const };
  const started = Date.now();
  const deadline = started + budgetMs;
  const lock = await acquireClassifyLock();
  if (!lock) return { skipped: "busy" as const };
  try {
    // Lo del CRM, como mucho la mitad del tiempo; el resto, la tanda.
    const crm = await refreshCrmCategories({ deadline: started + budgetMs / 2 });
    // Sin clave, solo reglas (no sale nada de la base).
    const run = await classifyPending({ limit: 40, budgetMs: deadline - Date.now(), leaseHeld: true });
    return { crm, ...run };
  } finally {
    await releaseClassifyLock(lock);
  }
};

// ── Manual ────────────────────────────────────────────────────────────────

/** El equipo decide la categoría. Gana siempre: nada automático la pisa. */
export const setManualCategory = async (id: string, category: ChatCategory, staffId: string | null) => {
  if (!CHAT_CATEGORIES.includes(category)) throw new Error("INVALID_CATEGORY");
  const before = await prisma.conversation.findFirst({
    where: { id, channel: "WHATSAPP" },
    select: { category: true, categorySource: true, lastMessageAt: true },
  });
  if (!before) return null;
  const updated = await prisma.conversation.update({
    where: { id },
    data: {
      category,
      categorySource: "manual",
      categoryConfidence: 1,
      categoryReason: "Lo marcó el equipo",
      categoryReview: false,
      categorizedAt: new Date(),
      categorizedThroughAt: before.lastMessageAt,
    },
    select: { id: true, category: true, categorySource: true },
  });
  await writeAuditLog({
    staffUserId: staffId ?? undefined,
    action: "UPDATE",
    entityType: "ConversationCategory",
    entityId: id,
    changes: { from: { category: before.category, source: before.categorySource }, to: { category, source: "manual" } },
  });
  return updated;
};

/** Quita la marca manual: el chat vuelve a clasificarse solo. */
export const clearManualCategory = async (id: string, staffId: string | null): Promise<ClassifyOutcome | null> => {
  const before = await prisma.conversation.findFirst({
    where: { id, channel: "WHATSAPP" },
    select: { category: true, categorySource: true },
  });
  if (!before) return null;
  if (before.categorySource === "manual") {
    await prisma.conversation.update({
      where: { id },
      data: {
        category: null,
        categorySource: null,
        categoryConfidence: null,
        categoryReason: null,
        categoryReview: false,
        categorizedAt: null,
        categorizedThroughAt: null,
      },
    });
    await writeAuditLog({
      staffUserId: staffId ?? undefined,
      action: "UPDATE",
      entityType: "ConversationCategory",
      entityId: id,
      changes: { from: { category: before.category, source: "manual" }, to: { category: null, source: "auto" } },
    });
  }
  return classifyConversation(id, { force: true });
};

// ── Equipo ────────────────────────────────────────────────────────────────

export type TeamPhonesResult =
  | { ok: false; invalid: string[] }
  | {
      ok: true;
      phones: string[];
      /** Números del equipo que son de alguien que pagó: ojo, se silenciarían. */
      warnings: { phone: string; name: string }[];
      reclassified: ClassifyOutcome[];
    };

/**
 * Guarda los números del equipo. Rechaza los que no traen código de país
 * (salvo un celular de Colombia de 10 dígitos que empieza por 3). Avisa si
 * alguno es de una clienta, y vuelve a mirar —solo con reglas, sin IA— los
 * chats de los números que entran o salen (los manuales no se tocan).
 */
export const setTeamPhones = async (phones: string[], staffId: string | null): Promise<TeamPhonesResult> => {
  const invalid = phones.filter((p) => !normalizeTeamPhone(p));
  if (invalid.length) return { ok: false, invalid };
  const next = [...new Set(phones.map((p) => normalizeTeamPhone(p)!))];
  const prev = await getTeamPhones();
  await setSiteSetting(TEAM_PHONES_KEY, JSON.stringify(next));
  await writeAuditLog({
    staffUserId: staffId ?? undefined,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: TEAM_PHONES_KEY,
    changes: { from: prev, to: next },
  });

  const paying = next.length
    ? await prisma.contact.findMany({
        where: {
          phoneE164: { in: next.flatMap((p) => contactPhoneCandidates(p)) },
          enrollments: {
            some: {
              OR: [
                { status: { in: ["ACTIVE", "COMPLETED"] }, amountMinor: { gt: 0 } },
                { payments: { some: { status: "APPROVED" } } },
              ],
            },
          },
        },
        select: { phoneE164: true, firstName: true, lastName: true },
      })
    : [];
  const warnings = paying.map((c) => ({ phone: c.phoneE164, name: `${c.firstName} ${c.lastName ?? ""}`.trim() }));

  const changed = [...prev.filter((p) => !next.includes(p)), ...next.filter((p) => !prev.includes(p))];
  const threads = [...new Set(changed.flatMap(phoneDigitVariants))];
  const affected = threads.length
    ? await prisma.conversation.findMany({
        where: { channel: "WHATSAPP", externalThreadId: { in: threads }, AND: [notManual] },
        select: { id: true },
      })
    : [];
  // Quien sale del equipo no se queda con «equipo»: queda sin clasificar y
  // el reloj lo vuelve a mirar (con IA si hace falta).
  if (affected.length) {
    await prisma.conversation.updateMany({
      where: { id: { in: affected.map((c) => c.id) }, category: "equipo", AND: [notManual] },
      data: {
        category: null,
        categorySource: null,
        categoryConfidence: null,
        categoryReason: null,
        categoryReview: false,
        categorizedThroughAt: null,
      },
    });
  }
  const reclassified: ClassifyOutcome[] = [];
  for (const c of affected) reclassified.push(await classifyConversation(c.id, { force: true, useAi: false }));
  return { ok: true, phones: next, warnings, reclassified };
};

// ── Contadores ────────────────────────────────────────────────────────────

export type CategoryCounts = {
  total: number;
  counts: Record<ChatCategory, number>;
  /** Sin categoría todavía. */
  unclassified: number;
  /** Etiquetas con poca confianza: «revisar». */
  review: number;
  manual: number;
  /** Sin clasificar o con mensajes nuevos desde la última vez. */
  pending: number;
  enabled: boolean;
  hasModelKey: boolean;
  teamPhones: string[];
};

export const categoryCounts = async (): Promise<CategoryCounts> => {
  const where = { channel: "WHATSAPP" as const };
  const [groups, review, manual, pending, enabled, teamPhones] = await Promise.all([
    prisma.conversation.groupBy({ by: ["category"], where, _count: { _all: true } }),
    prisma.conversation.count({ where: { ...where, categoryReview: true, AND: [notManual] } }),
    prisma.conversation.count({ where: { ...where, categorySource: "manual" } }),
    prisma.conversation.count({ where: pendingClassificationWhere() }),
    isClassifyEnabled(),
    getTeamPhones(),
  ]);
  const counts = Object.fromEntries(CHAT_CATEGORIES.map((c) => [c, 0])) as Record<ChatCategory, number>;
  let unclassified = 0;
  let total = 0;
  for (const g of groups) {
    total += g._count._all;
    if (g.category && (CHAT_CATEGORIES as readonly string[]).includes(g.category)) {
      counts[g.category as ChatCategory] += g._count._all;
    } else {
      unclassified += g._count._all;
    }
  }
  return { total, counts, unclassified, review, manual, pending, enabled, hasModelKey: hasModelKey(), teamPhones };
};
