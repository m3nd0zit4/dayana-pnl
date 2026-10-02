import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { contactPhoneCandidates, isWhatsAppUserId } from "@/lib/whatsapp-contact";
import { writeAuditLog } from "./audit";
import { classifyWithAi } from "./chat-category-ai";
import {
  CHAT_CATEGORIES,
  classifyByRules,
  isTeamThread,
  normalizeTeamPhone,
  parseTeamPhones,
  phoneDigitVariants,
  signalHints,
  type CategoryMessage,
  type CategorySignals,
  type ChatCategory,
  type ChatFacts,
} from "./chat-category-rules";
import { getSiteSetting, getSiteSettingBoolean, setSiteSetting } from "./site-settings";

/**
 * Clasificación de los chats de WhatsApp: carga lo que sabe el CRM de cada
 * chat, aplica las reglas (chat-category-rules.ts) y, si no deciden, pregunta
 * al modelo (chat-category-ai.ts). Lo marcado a mano nunca se pisa.
 *
 * Un chat se vuelve a mirar cuando tiene mensajes nuevos desde la última vez
 * (`categorizedThroughAt < lastMessageAt`). Si la última decisión fue de la IA
 * y la persona no escribió nada nuevo, se conserva sin volver a llamarla.
 */

export const TEAM_PHONES_KEY = "whatsapp.team_phones";
export const CLASSIFY_ENABLED_KEY = "whatsapp.classify_enabled";

/** Mensajes que leen las reglas (la IA usa los últimos 30 de estos). */
const RULE_MESSAGES = 60;

const hasModelKey = () => Boolean(process.env.GEMINI_API_KEY?.trim());

// ── Ajustes ───────────────────────────────────────────────────────────────

export const getTeamPhones = async (): Promise<string[]> => parseTeamPhones(await getSiteSetting(TEAM_PHONES_KEY));

/** Apagado a mano en Ajustes (`whatsapp.classify_enabled = false`). Encendido por defecto. */
export const isClassifyEnabled = async (): Promise<boolean> =>
  (await getSiteSettingBoolean(CLASSIFY_ENABLED_KEY)) !== false;

// ── Carga ─────────────────────────────────────────────────────────────────

const CONVERSATION_SELECT = {
  id: true,
  channel: true,
  externalThreadId: true,
  contactId: true,
  participantName: true,
  lastMessageAt: true,
  lastInboundAt: true,
} as const;

/** Lo mínimo de un chat para clasificarlo (sin las columnas de la clasificación). */
export type ConversationBase = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

type ClassificationState = {
  category: string | null;
  categorySource: string | null;
  categorizedThroughAt: Date | null;
};

const STATE_SELECT = { category: true, categorySource: true, categorizedThroughAt: true } as const;

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

/**
 * Señales del CRM y últimos mensajes de varios chats a la vez: una consulta
 * por tabla, no una por chat. Solo lee: sirve también para la vista previa
 * contra una base sin la migración.
 */
export const loadFactsBatch = async (
  conversations: ConversationBase[],
  teamPhones: string[]
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

  const [enrollments, diagnostics, registrations, bookings, appointments, known, communities, messageRows] =
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
      prisma.$queryRaw<MessageRow[]>(Prisma.sql`
        SELECT conversation_id, direction::text AS direction, body, kind, is_echo, is_auto_reply, source, attachments, sent_at
        FROM (
          SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at DESC) AS rn
          FROM conversation_messages m
          WHERE m.conversation_id IN (${Prisma.join(ids)})
        ) t
        WHERE t.rn <= ${RULE_MESSAGES}
        ORDER BY sent_at ASC`),
    ]);

  const messagesOf = new Map<string, CategoryMessage[]>();
  for (const r of messageRows) {
    const list = messagesOf.get(r.conversation_id) ?? [];
    list.push({
      direction: r.direction,
      body: r.body,
      kind: r.kind,
      isEcho: r.is_echo,
      isAutoReply: r.is_auto_reply,
      source: r.source,
      attachments: r.attachments,
    });
    messagesOf.set(r.conversation_id, list);
  }
  const knownPhones = new Set(known.map((k) => k.phone));

  for (const c of conversations) {
    const cids = new Set(contactIdsOf.get(c.id));
    const { e164, digits } = phones.get(c.id)!;
    const forms = new Set([...e164, ...digits]);
    const mine = <T extends { contactId: string | null }>(rows: T[]) => rows.filter((r) => r.contactId && cids.has(r.contactId));
    const ownEnrollments = mine(enrollments);
    const paid = ownEnrollments.find(
      (e) => (e.status === "ACTIVE" || e.status === "COMPLETED") && e.amountMinor !== 0
    );
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
      hasApprovedPayment: ownEnrollments.some((e) => e.payments.length > 0),
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
      messages: messagesOf.get(c.id) ?? [],
      participantName: c.participantName,
      everWrote: c.lastInboundAt !== null,
    });
  }
  return out;
};

// ── Decidir y guardar ─────────────────────────────────────────────────────

export type ClassifyOutcome =
  | { id: string; status: "skipped"; reason: "not_found" | "manual" | "up_to_date" | "needs_ai" }
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
  | { id: string; status: "error"; error: string };

/** Nunca escribe sobre una clasificación manual, aunque se haya puesto mientras tanto. */
const notManual = { OR: [{ categorySource: null }, { categorySource: { not: "manual" } }] };

const save = async (
  id: string,
  through: Date,
  data: { category: ChatCategory; source: "rule" | "ai"; confidence: number; reason: string; review: boolean }
) => {
  const r = await prisma.conversation.updateMany({
    where: { id, ...notManual },
    data: {
      category: data.category,
      categorySource: data.source,
      categoryConfidence: data.confidence,
      categoryReason: data.reason.slice(0, 200),
      categoryReview: data.review,
      categorizedAt: new Date(),
      categorizedThroughAt: through,
    },
  });
  return r.count > 0;
};

const classifyLoaded = async (
  conversation: ConversationBase & ClassificationState,
  facts: LoadedFacts,
  opts: { force?: boolean; useAi: boolean }
): Promise<ClassifyOutcome> => {
  const id = conversation.id;
  if (conversation.categorySource === "manual") return { id, status: "skipped", reason: "manual" };
  if (
    !opts.force &&
    conversation.categorizedThroughAt &&
    conversation.categorizedThroughAt.getTime() >= conversation.lastMessageAt.getTime()
  ) {
    return { id, status: "skipped", reason: "up_to_date" };
  }
  const through = conversation.lastMessageAt;

  const rule = classifyByRules(facts);
  if (rule) {
    const data = { ...rule, source: "rule" as const, review: false };
    if (!(await save(id, through, data))) return { id, status: "skipped", reason: "manual" };
    return { id, status: "classified", ...data };
  }

  // La IA ya habló y la persona no escribió nada desde entonces (solo
  // mensajes nuestros): se conserva sin pagar otra llamada.
  const lastInbound = conversation.lastInboundAt?.getTime() ?? 0;
  if (
    !opts.force &&
    conversation.categorySource === "ai" &&
    conversation.category &&
    conversation.categorizedThroughAt &&
    conversation.categorizedThroughAt.getTime() >= lastInbound
  ) {
    const r = await prisma.conversation.updateMany({
      where: { id, categorySource: "ai" },
      data: { categorizedThroughAt: through },
    });
    if (r.count === 0) return { id, status: "skipped", reason: "manual" };
    const kept = await prisma.conversation.findUniqueOrThrow({
      where: { id },
      select: { categoryConfidence: true, categoryReason: true, categoryReview: true },
    });
    return {
      id,
      status: "classified",
      category: conversation.category as ChatCategory,
      source: "ai",
      confidence: kept.categoryConfidence ?? 0,
      reason: kept.categoryReason ?? "",
      review: kept.categoryReview,
      kept: true,
    };
  }

  if (!opts.useAi || !hasModelKey()) return { id, status: "skipped", reason: "needs_ai" };
  const ai = await classifyWithAi({ messages: facts.messages, hints: signalHints(facts) });
  const data = { category: ai.category, source: "ai" as const, confidence: ai.confidence, reason: ai.reason, review: ai.review };
  if (!(await save(id, through, data))) return { id, status: "skipped", reason: "manual" };
  return {
    id,
    status: "classified",
    ...data,
    model: ai.model,
    latencyMs: ai.latencyMs,
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
  };
};

/**
 * Clasifica un chat. `force` lo vuelve a mirar aunque no tenga mensajes
 * nuevos (y vuelve a preguntar a la IA), pero nunca pisa lo manual.
 */
export const classifyConversation = async (
  id: string,
  opts: { force?: boolean; useAi?: boolean } = {}
): Promise<ClassifyOutcome> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { ...CONVERSATION_SELECT, ...STATE_SELECT },
  });
  if (!conversation) return { id, status: "skipped", reason: "not_found" };
  if (conversation.categorySource === "manual") return { id, status: "skipped", reason: "manual" };
  const facts = (await loadFactsBatch([conversation], await getTeamPhones())).get(id)!;
  try {
    return await classifyLoaded(conversation, facts, { force: opts.force, useAi: opts.useAi ?? true });
  } catch (e) {
    return { id, status: "error", error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
};

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

export type ClassifyRunResult = {
  processed: number;
  classified: number;
  byRule: number;
  byAi: number;
  /** Se conservó lo que había dicho la IA (sin mensajes nuevos de la persona). */
  kept: number;
  review: number;
  /** Dudosos que esperan a la IA (sin clave o `useAi: false`). */
  needsAi: number;
  failed: number;
  skipped: number;
  /** Pendientes que quedan después de esta tanda. */
  remaining: number;
  models: string[];
  ms: number;
  errors: string[];
};

/**
 * Una tanda: los chats pendientes con actividad más reciente primero, hasta
 * `limit` o hasta agotar `budgetMs` (no empieza uno nuevo pasado el tiempo).
 * Sin IA (o sin clave) recorre todos: las reglas son baratas.
 */
export const classifyPending = async (
  opts: { limit?: number; budgetMs?: number; useAi?: boolean; concurrency?: number } = {}
): Promise<ClassifyRunResult> => {
  const started = Date.now();
  const useAi = (opts.useAi ?? true) && hasModelKey();
  const budgetMs = opts.budgetMs ?? 40_000;
  const result: ClassifyRunResult = {
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
    ms: 0,
    errors: [],
  };

  const batch = await prisma.conversation.findMany({
    where: pendingClassificationWhere(),
    orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
    take: useAi ? (opts.limit ?? 40) : 1000,
    select: { ...CONVERSATION_SELECT, ...STATE_SELECT },
  });
  if (batch.length > 0) {
    const facts = await loadFactsBatch(batch, await getTeamPhones());
    let next = 0;
    const worker = async () => {
      while (next < batch.length && Date.now() - started < budgetMs) {
        const conversation = batch[next++];
        let outcome: ClassifyOutcome;
        try {
          outcome = await classifyLoaded(conversation, facts.get(conversation.id)!, { useAi });
        } catch (e) {
          outcome = { id: conversation.id, status: "error", error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        }
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
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, batch.length)) }, worker));
  }

  result.remaining = await prisma.conversation.count({ where: pendingClassificationWhere() });
  result.ms = Date.now() - started;
  return result;
};

/** El paso del reloj de WhatsApp: solo con clave del modelo y sin el interruptor apagado. */
export const classifyFromCron = async (budgetMs: number) => {
  if (!hasModelKey()) return { skipped: "no_model_key" as const };
  if (!(await isClassifyEnabled())) return { skipped: "disabled" as const };
  if (budgetMs < 5_000) return { skipped: "no_time" as const };
  return classifyPending({ limit: 40, budgetMs });
};

// ── Manual ────────────────────────────────────────────────────────────────

/** El equipo decide la categoría. Gana siempre: nada automático la pisa. */
export const setManualCategory = async (id: string, category: ChatCategory, staffId: string | null) => {
  if (!CHAT_CATEGORIES.includes(category)) throw new Error("INVALID_CATEGORY");
  const before = await prisma.conversation.findUnique({
    where: { id },
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
  const before = await prisma.conversation.findUnique({ where: { id }, select: { category: true, categorySource: true } });
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

/**
 * Guarda los números del equipo y vuelve a mirar los chats de los números
 * que entran o salen de la lista (los manuales no se tocan).
 */
export const setTeamPhones = async (phones: string[], staffId: string | null) => {
  const next = [...new Set(phones.map(normalizeTeamPhone).filter((p): p is string => p !== null))];
  const prev = await getTeamPhones();
  await setSiteSetting(TEAM_PHONES_KEY, JSON.stringify(next));
  await writeAuditLog({
    staffUserId: staffId ?? undefined,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: TEAM_PHONES_KEY,
    changes: { from: prev, to: next },
  });

  const changed = [...prev.filter((p) => !next.includes(p)), ...next.filter((p) => !prev.includes(p))];
  const threads = [...new Set(changed.flatMap(phoneDigitVariants))];
  const affected = threads.length
    ? await prisma.conversation.findMany({
        where: { channel: "WHATSAPP", externalThreadId: { in: threads }, ...notManual },
        select: { id: true },
      })
    : [];
  // Quien sale del equipo no se queda con «equipo» si la IA no responde:
  // queda sin clasificar y el reloj lo vuelve a intentar.
  if (affected.length) {
    await prisma.conversation.updateMany({
      where: { id: { in: affected.map((c) => c.id) }, category: "equipo", ...notManual },
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
  const outcomes: ClassifyOutcome[] = [];
  for (const c of affected) outcomes.push(await classifyConversation(c.id, { force: true }));
  return { phones: next, reclassified: outcomes };
};

// ── Contadores ────────────────────────────────────────────────────────────

export type CategoryCounts = {
  total: number;
  counts: Record<ChatCategory, number>;
  /** Sin categoría todavía. */
  unclassified: number;
  /** La IA no estaba segura: «revisar». */
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
    prisma.conversation.count({ where: { ...where, categoryReview: true, ...notManual } }),
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
