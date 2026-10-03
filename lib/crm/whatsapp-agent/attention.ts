import type { NotificationEventType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { markReadByEntity } from "@/lib/notifications/platform/feed";
import {
  SEGUIMIENTO_QUIET_HOURS,
  SEGUIMIENTO_WINDOW_DAYS,
  burstState,
  canClose,
  closesAttention,
  isAutoSend,
  isSensitiveEscalation,
  mergeAttention,
  type AttentionReason,
  type CloseBy,
} from "../whatsapp-attention-rules";

export type { CloseBy };

/**
 * «Te toca» en la base: quién entra, quién sale y la consulta que usan la
 * cola, los contadores, el menú, la portada, los pendientes del CRM y la
 * herramienta del agente. Las reglas puras viven en `../whatsapp-attention-rules`.
 *
 * - Entra (`openAttention`): una escalada de la IA, «quiere agendar», una
 *   autoevaluación urgente, o un mensaje que importa en un chat donde la IA no
 *   va a contestar (manual, favorito, IA apagada, en pausa, tope del día…).
 * - Sale (`closeAttention`): Dayana contesta (CRM o eco del celular), pulsa
 *   «Listo», aprueba lo que propuso la IA, o se agenda / confirma una cita o un
 *   pago — cada cosa cierra solo lo suyo (`canClose`).
 * - Lo que espera su autorización (`AWAITING_APPROVAL`) también le toca, por
 *   su cuenta: sale al aprobarlo, cancelarlo o contestar ella.
 *
 * Importes estáticos a propósito: esto lo usan `run.ts`, `approvals.ts` y
 * `workspace.ts`, que se empaquetan también para el agente (eve no admite un
 * `import()` dinámico nuevo en ese árbol).
 */

/**
 * La única definición de «Te toca». Cuando los chats tengan categoría, lo
 * personal y lo de negocio se sacan aquí con una línea:
 *   `{ OR: [{ category: null }, { category: { notIn: ["personal", "negocio"] } }] }`
 */
export const attentionWhere = (): Prisma.ConversationWhereInput => ({
  channel: "WHATSAPP",
  AND: [{ OR: [{ attentionAt: { not: null } }, { aiRuns: { some: { status: "AWAITING_APPROVAL" } } }] }],
});

/** Avisos de la campana que pierden sentido cuando el chat se atiende. */
const CHAT_NOTICES: NotificationEventType[] = ["WHATSAPP_AI_ESCALATED", "WHATSAPP_AI_APPROVAL", "WHATSAPP_AI_INFO"];

/** Los avisos del chat, leídos para todo el equipo (los creados hasta `before`). */
export const markChatNoticesRead = (
  conversationId: string,
  before: Date = new Date(),
  eventTypes: NotificationEventType[] = CHAT_NOTICES
) =>
  markReadByEntity({ entityType: "Conversation", entityId: conversationId, eventTypes, before }).catch(
    (e: unknown) => {
      console.warn("[te toca] no se pudieron marcar los avisos como leídos", e);
      return 0;
    }
  );

/**
 * Abre «Te toca» desde `at` (el mensaje que lo pide; por defecto, ahora). Si
 * ya estaba abierto se queda la fecha más vieja; una escalada pisa «sin
 * responder». Devuelve si cambió algo.
 */
export const openAttention = async (
  conversationId: string,
  reason: AttentionReason,
  at: Date = new Date()
): Promise<boolean> => {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { attentionAt: true, attentionReason: true },
  });
  if (!c) return false;
  const next = mergeAttention({ at: c.attentionAt, reason: c.attentionReason }, { at, reason });
  if (!next) return false;
  // Si entre leer y escribir otro proceso la cambió (p. ej. Dayana contestó), gana él.
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, attentionAt: c.attentionAt },
    data: { attentionAt: next.at, attentionReason: next.reason },
  });
  return count > 0;
};

const BURST_SELECT = {
  direction: true,
  isEcho: true,
  isAutoReply: true,
  source: true,
  kind: true,
  status: true,
  clientKey: true,
  body: true,
  attachments: true,
  sentAt: true,
} as const;

/** Cuánto atrás cuenta una oferta aprobada (horas, cita, enlace de pago) para que un «ok» sea un «sí». */
const OFFER_HOURS = 12;

/** ¿Hace poco Dayana aprobó ofrecerle horas, una cita o un enlace de pago? */
export const recentOffer = async (conversationId: string, now: Date = new Date()): Promise<boolean> => {
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, status: "APPROVED", decidedAt: { gte: new Date(now.getTime() - OFFER_HOURS * 3600_000) } },
    select: { proposal: true },
  });
  return runs.some((r) => ["slots", "booking", "payment_link"].includes((r.proposal as { kind?: string } | null)?.kind ?? ""));
};

/**
 * El primer mensaje que importa de lo que la persona escribió desde la última
 * respuesta (solo lo posterior a `after`, si se pasa). `null` si no hay nada
 * que pida respuesta: «gracias», un sticker, un 👍 a algo que no preguntamos.
 */
const unansweredSince = async (conversationId: string, after?: Date): Promise<Date | null> => {
  const [rows, offer, conv] = await Promise.all([
    prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { sentAt: "desc" },
      take: 40,
      select: BURST_SELECT,
    }),
    recentOffer(conversationId),
    prisma.conversation.findUnique({ where: { id: conversationId }, select: { lastHumanReplyAt: true } }),
  ]);
  // Lo escrito hasta su última respuesta (o hasta `after`) ya está atendido.
  const covered = [conv?.lastHumanReplyAt?.getTime(), after?.getTime()].filter((t): t is number => t !== undefined);
  const coveredUntil = covered.length ? new Date(Math.max(...covered)) : null;
  return burstState(rows, { recentOffer: offer, coveredUntil }).since;
};

/**
 * La IA no va a contestar (chat manual, favorito, IA apagada, en pausa…), una
 * respuesta no llegó o la IA se cortó: si lo que escribió la persona importa,
 * le toca a Dayana. Un «gracias» no.
 */
export const openAttentionIfNeedsReply = async (conversationId: string): Promise<boolean> => {
  const since = await unansweredSince(conversationId);
  if (!since) return false;
  return openAttention(conversationId, "unanswered", since);
};

/**
 * Cierra «Te toca» si quien cierra puede (`canClose`: una cita no cierra un
 * pago, aprobar no cierra algo delicado) y lo abierto es anterior a `upTo` (un
 * eco viejo que llega tarde no cierra lo que vino después). Lo que la persona
 * escribió después de `upTo` y nadie contestó lo deja abierto («sin
 * responder», desde ese mensaje).
 *
 * - Una escalada atendida pasa a pausa humana (la IA vuelve pasadas las horas
 *   de relevo), salvo si es delicada (clínica, pago, urgente): esa sigue
 *   apartada hasta «Listo».
 * - Los avisos de la campana de ese chat quedan leídos para todos (si se
 *   cerró; aprobar algo deja leído al menos su aviso de «autoriza»).
 */
export const closeAttention = async (
  conversationId: string,
  opts: { by: CloseBy; upTo?: Date }
): Promise<boolean> => {
  const now = new Date();
  const upTo = opts.upTo ?? now;
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      attentionAt: true,
      attentionReason: true,
      aiPausedReason: true,
      escalationCategory: true,
      escalationSeverity: true,
    },
  });
  if (!c) return false;
  const escalated = c.aiPausedReason === "escalation";
  const urgent = escalated && c.escalationSeverity === "urgent";

  let closed = false;
  if (closesAttention(c.attentionAt, upTo) && canClose(opts.by, { reason: c.attentionReason, urgent })) {
    const later = await unansweredSince(conversationId, upTo);
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversationId, attentionAt: c.attentionAt },
      data: later
        ? { attentionAt: later, attentionReason: "unanswered" }
        : { attentionAt: null, attentionReason: null },
    });
    closed = count > 0;
    if (
      closed &&
      escalated &&
      opts.by !== "ai" &&
      (opts.by === "listo" ||
        !isSensitiveEscalation({ category: c.escalationCategory, severity: c.escalationSeverity }))
    ) {
      await prisma.conversation.updateMany({
        where: { id: conversationId, aiPausedReason: "escalation" },
        data: { aiPausedReason: "human", aiPausedAt: now },
      });
    }
  }
  if (opts.by === "ai") return closed;
  // «Listo» cubre todo lo que había hasta ahora; una respuesta, lo de antes de ella.
  const before = opts.by === "listo" ? now : upTo;
  if (closed || opts.by === "reply" || opts.by === "listo") await markChatNoticesRead(conversationId, before);
  else if (opts.by === "approval") await markChatNoticesRead(conversationId, now, ["WHATSAPP_AI_APPROVAL"]);
  return closed;
};

/**
 * Una persona contestó en este chat (CRM o eco del celular) en `sentAt`, o
 * aprobó una propuesta que la IA pensó con lo escrito hasta `sentAt`: queda
 * anotado y, si le tocaba, sale de «Te toca».
 */
export const noteHumanReply = async (
  conversationId: string,
  sentAt: Date,
  by: "reply" | "approval" = "reply"
): Promise<boolean> => {
  // Los avisos llegan en desorden: solo avanza.
  await prisma.conversation.updateMany({
    where: { id: conversationId, OR: [{ lastHumanReplyAt: null }, { lastHumanReplyAt: { lt: sentAt } }] },
    data: { lastHumanReplyAt: sentAt },
  });
  return closeAttention(conversationId, { by, upTo: sentAt });
};

/**
 * Hasta dónde cubre aprobar una propuesta: el último mensaje de la persona que
 * la IA leyó al pensarla (lo que llegó después no lo atendió nadie). Sin
 * mensajes suyos, el momento en que la IA empezó.
 */
export const approvalCoversUntil = async (runId: string): Promise<Date> => {
  const run = await prisma.whatsAppAiRun.findUnique({
    where: { id: runId },
    select: { conversationId: true, startedAt: true, queuedAt: true },
  });
  if (!run) return new Date();
  const readUntil = run.startedAt ?? run.queuedAt;
  const lastRead = await prisma.conversationMessage.findFirst({
    where: { conversationId: run.conversationId, direction: "INBOUND", kind: "message", sentAt: { lte: readUntil } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return lastRead?.sentAt ?? readUntil;
};

/** ¿Este mensaje es una respuesta de una persona? (CRM con su usuario o eco del celular; sin aprobaciones). */
const humanMessageWhere = (conversationId: string): Prisma.ConversationMessageWhereInput => ({
  conversationId,
  direction: "OUTBOUND",
  kind: "message",
  status: { not: "FAILED" },
  OR: [{ isEcho: true }, { staffUserId: { not: null }, isAutoReply: false, NOT: { source: "approval" } }],
});

/**
 * WhatsApp avisó que una respuesta de Dayana no llegó: no cuenta como
 * respuesta. Si era la última, se recalcula; y si lo que escribió la persona
 * importa, vuelve a «Te toca».
 */
export const reopenAfterFailedReply = async (messageId: string): Promise<boolean> => {
  const m = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: {
      conversationId: true,
      direction: true,
      sentAt: true,
      staffUserId: true,
      isAutoReply: true,
      isEcho: true,
      source: true,
      clientKey: true,
      conversation: { select: { channel: true, lastHumanReplyAt: true } },
    },
  });
  if (!m || m.direction !== "OUTBOUND" || m.conversation.channel !== "WHATSAPP") return false;
  const human = m.isEcho || m.source === "approval" || (Boolean(m.staffUserId) && !m.isAutoReply && !isAutoSend(m));
  if (!human) return false;
  const current = m.conversation.lastHumanReplyAt;
  // Una aprobación anota hasta dónde leyó la IA (antes de enviarse): si falla, también se recalcula.
  if (current && (m.source === "approval" || current.getTime() >= m.sentAt.getTime() - 60_000)) {
    const latest = await prisma.conversationMessage.findFirst({
      where: humanMessageWhere(m.conversationId),
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    await prisma.conversation.update({
      where: { id: m.conversationId },
      data: { lastHumanReplyAt: latest?.sentAt ?? null },
    });
  }
  return openAttentionIfNeedsReply(m.conversationId);
};

export type ListoResult = "ok" | "new_message" | "not_found";

/**
 * «Listo»: Dayana lo dio por atendido. Sale de «Te toca», se retira lo que la
 * IA proponía y una escalada (también la delicada) pasa a pausa humana: la IA
 * vuelve pasadas las horas de relevo. No cambia el modo del chat.
 * `seenInboundAt`: el último mensaje de la persona que ella tenía en pantalla;
 * si llegó otro después, no se cierra (no se traga un mensaje sin leer).
 */
export const markAttended = async (
  conversationId: string,
  staffId: string | null,
  seenInboundAt?: Date | null
): Promise<ListoResult> => {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundAt: true },
  });
  if (!c) return "not_found";
  if (seenInboundAt && c.lastInboundAt && c.lastInboundAt.getTime() > seenInboundAt.getTime()) return "new_message";
  const now = new Date();
  await prisma.whatsAppAiRun.updateMany({
    where: { conversationId, status: "AWAITING_APPROVAL" },
    data: { status: "SUPERSEDED", reason: "Lo diste por atendido.", decidedAt: now, decidedById: staffId },
  });
  await prisma.conversation.updateMany({
    where: { id: conversationId, draftSource: "AI" },
    data: { draftBody: null, draftSource: null, draftUpdatedAt: null },
  });
  await closeAttention(conversationId, { by: "listo", upTo: now });
  await prisma.conversation.updateMany({
    where: { id: conversationId, aiPausedReason: "escalation" },
    data: { aiPausedReason: "human", aiPausedAt: now },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { resolvedAt: now, resolvedReason: "manual", resolvedById: staffId },
  });
  return "ok";
};

/**
 * La IA vuelve a atender el chat («Devolver a la IA», cambiar el modo,
 * reanudar): si había una escalada, lo que esa escalada abrió en «Te toca» se
 * cierra con ella. Un «sin responder» se queda (alguien tiene que contestarlo).
 */
export const clearEscalationAttention = async (conversationId: string): Promise<void> => {
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, attentionAt: { not: null }, NOT: { attentionReason: "unanswered" } },
    data: { attentionAt: null, attentionReason: null },
  });
  if (count > 0) await markChatNoticesRead(conversationId);
};

/**
 * «Seguimiento» (v1, se afinará con las categorías): gente que escribió y se
 * quedó en el aire sin agendar ni pagar.
 *
 * - La persona escribió alguna vez, y lo último que escribió es de los
 *   últimos `SEGUIMIENTO_WINDOW_DAYS` días (lo anterior es archivo).
 * - Nada se movió en el chat en `SEGUIMIENTO_QUIET_HOURS` horas.
 * - No está en «Te toca» (eso va primero).
 * - Sin cita por delante: ni en el calendario (por chat, número o contacto)
 *   ni agendada por la IA.
 * - No es clienta: sin matrícula activa ni terminada.
 * - No quedó cerrado por una cita o un pago (si escribe otra vez, se reabre).
 * - No pidió que no le escribieran.
 */
export const seguimientoWhere = async (now: Date = new Date()): Promise<Prisma.ConversationWhereInput> => {
  const quiet = new Date(now.getTime() - SEGUIMIENTO_QUIET_HOURS * 3600_000);
  const oldest = new Date(now.getTime() - SEGUIMIENTO_WINDOW_DAYS * 24 * 3600_000);
  const upcoming = await prisma.calendarAppointment.findMany({
    where: { status: "active", startsAt: { gt: now } },
    select: { conversationId: true, contactId: true, phone: true },
  });
  const uniq = (v: (string | null)[]) => [...new Set(v.filter((x): x is string => Boolean(x)))];
  const convIds = uniq(upcoming.map((a) => a.conversationId));
  const contactIds = uniq(upcoming.map((a) => a.contactId));
  const phones = uniq(upcoming.map((a) => a.phone));
  return {
    channel: "WHATSAPP",
    AND: [
      { lastInboundAt: { not: null, gte: oldest } },
      { lastMessageAt: { lt: quiet } },
      { attentionAt: null },
      { aiRuns: { none: { status: "AWAITING_APPROVAL" } } },
      { aiBookings: { none: { status: "BOOKED", startsAt: { gt: now } } } },
      ...(convIds.length ? [{ id: { notIn: convIds } }] : []),
      ...(phones.length ? [{ externalThreadId: { notIn: phones } }] : []),
      ...(contactIds.length ? [{ OR: [{ contactId: null }, { contactId: { notIn: contactIds } }] }] : []),
      {
        OR: [
          { contactId: null },
          {
            contact: {
              notifyWhatsapp: true,
              enrollments: { none: { status: { in: ["ACTIVE", "COMPLETED"] } } },
            },
          },
        ],
      },
      { OR: [{ resolvedReason: null }, { resolvedReason: { notIn: ["appointment", "payment"] } }] },
    ],
  };
};
