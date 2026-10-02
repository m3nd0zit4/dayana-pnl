import type { NotificationEventType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { markReadByEntity } from "@/lib/notifications/platform/feed";
import {
  SEGUIMIENTO_QUIET_HOURS,
  SEGUIMIENTO_WINDOW_DAYS,
  closesAttention,
  firstNeedingReply,
  inboundSinceLastReply,
  mergeAttention,
  type AttentionReason,
} from "../whatsapp-attention-rules";

/**
 * «Te toca» en la base: quién entra, quién sale y la consulta que usan la
 * cola, los contadores, el menú, la portada, los pendientes del CRM y la
 * herramienta del agente. Las reglas puras viven en `../whatsapp-attention-rules`.
 *
 * - Entra (`openAttention`): una escalada de la IA, «quiere agendar», una
 *   autoevaluación urgente, o un mensaje que importa en un chat donde la IA no
 *   va a contestar (manual, favorito, IA apagada, en pausa, tope del día…).
 * - Sale (`closeAttention`): Dayana contesta (CRM, propuesta aprobada o eco
 *   del celular), pulsa «Listo», o se agenda / confirma una cita o un pago.
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
export const markChatNoticesRead = (conversationId: string, before: Date = new Date()) =>
  markReadByEntity({ entityType: "Conversation", entityId: conversationId, eventTypes: CHAT_NOTICES, before }).catch(
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

/**
 * El primer mensaje que importa de lo que la persona escribió desde la última
 * respuesta (solo lo posterior a `after`, si se pasa). `null` si no hay nada
 * que pida respuesta: «gracias», un sticker, un 👍.
 */
const unansweredSince = async (conversationId: string, after?: Date): Promise<Date | null> => {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId, ...(after ? { sentAt: { gt: after } } : {}) },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: BURST_SELECT,
  });
  return firstNeedingReply(inboundSinceLastReply(rows));
};

/**
 * La IA no va a contestar (chat manual, favorito, IA apagada, en pausa…): si
 * lo que escribió la persona importa, le toca a Dayana. Un «gracias» no.
 */
export const openAttentionIfNeedsReply = async (conversationId: string): Promise<boolean> => {
  const since = await unansweredSince(conversationId);
  if (!since) return false;
  return openAttention(conversationId, "unanswered", since);
};

/** Quién cierra: su respuesta, una propuesta aprobada, «Listo», una cita, un pago o la IA. */
export type CloseBy = "reply" | "approval" | "listo" | "appointment" | "payment" | "ai";

/**
 * Cierra «Te toca» si lo abierto es anterior a `upTo` (la hora de la
 * respuesta; un eco viejo que llega tarde no cierra lo que vino después). Lo
 * que la persona escribió después de `upTo` y nadie contestó lo deja abierto
 * («sin responder», desde ese mensaje).
 *
 * - La IA (`ai`) solo cierra «sin responder»: nunca una escalada.
 * - Una escalada que Dayana atiende pasa a pausa humana: la IA vuelve pasadas
 *   las horas de relevo, como con cualquier respuesta suya. No se le devuelve ya.
 * - Los avisos de la campana de ese chat quedan leídos para todos.
 */
export const closeAttention = async (
  conversationId: string,
  opts: { by: CloseBy; upTo?: Date }
): Promise<boolean> => {
  const now = new Date();
  const upTo = opts.upTo ?? now;
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { attentionAt: true, attentionReason: true, aiPausedReason: true },
  });
  if (!c) return false;

  let closed = false;
  if (closesAttention(c.attentionAt, upTo) && (opts.by !== "ai" || c.attentionReason === "unanswered")) {
    const later = await unansweredSince(conversationId, upTo);
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversationId, attentionAt: c.attentionAt },
      data: later
        ? { attentionAt: later, attentionReason: "unanswered" }
        : { attentionAt: null, attentionReason: null },
    });
    closed = count > 0;
    if (closed && opts.by !== "ai" && c.aiPausedReason === "escalation") {
      await prisma.conversation.updateMany({
        where: { id: conversationId, aiPausedReason: "escalation" },
        data: { aiPausedReason: "human", aiPausedAt: now },
      });
    }
  }
  // «Listo» cubre todo lo que había hasta ahora; una respuesta, lo de antes de ella.
  if (opts.by !== "ai") await markChatNoticesRead(conversationId, opts.by === "listo" ? now : upTo);
  return closed;
};

/**
 * Una persona contestó en este chat (CRM, propuesta aprobada o eco del
 * celular) en `sentAt`: queda anotado y, si le tocaba, sale de «Te toca».
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

export type ListoResult = "ok" | "new_message" | "not_found";

/**
 * «Listo»: Dayana lo dio por atendido. Sale de «Te toca», se retira lo que la
 * IA proponía y una escalada pasa a pausa humana. No cambia el modo del chat.
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
