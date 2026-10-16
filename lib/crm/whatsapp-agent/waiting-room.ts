import { prisma } from "@/lib/db";
import { sendMetaMessage } from "@/lib/meta/send";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { whatsAppIdVariants } from "@/lib/whatsapp-contact";
import { getOperationalTimezone } from "../operational-timezone";
import { isAutoSend } from "../whatsapp-attention-rules";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { readCalendar } from "./calendar";
import { DEFAULT_WAITING, decideWaiting, waitingMessage, type WaitingDecision } from "./waiting-room-rules";

/**
 * La sala de espera de la llamada gratis, con la base y el calendario. Las
 * reglas están en `waiting-room-rules.ts`.
 *
 * - `handleWaitingRoom`: cuando la persona escribe. Va antes de todo lo demás
 *   del ejecutor (también en copiloto o con el chat en pausa: es un aviso
 *   corto y a tiempo, no una conversación), salvo con la IA apagada o en un
 *   favorito.
 * - `sweepWaitingRoom`: el reloj (cada 10 min), aunque la persona no escriba;
 *   solo con la ventana de 24 h abierta.
 */

type BusyReader = (from: Date, to: Date) => Promise<{ start: Date; end: Date }[]>;
let busyForTests: BusyReader | null = null;
/** Para las pruebas: lo ocupado del calendario sin llamar a Google. */
export const setWaitingCalendarForTests = (reader: BusyReader | null) => {
  busyForTests = reader;
};

/** Lo ocupado cerca de ahora: el calendario en vivo; si falla, las citas guardadas. */
const busyAround = async (config: WhatsAppAiConfig, now: Date, exceptId: string) => {
  const from = new Date(now.getTime() - 3 * 3600_000);
  const to = new Date(now.getTime() + 3600_000);
  if (busyForTests) return busyForTests(from, to);
  try {
    const view = await readCalendar(config.booking, from, to, await getOperationalTimezone());
    return view.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch (e) {
    console.warn("[sala de espera] no se pudo leer el calendario; uso las citas guardadas", e instanceof Error ? e.message : e);
    const rows = await prisma.calendarAppointment.findMany({
      where: { status: "active", id: { not: exceptId }, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    });
    return rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
  }
};

/** La cita de esta persona más cerca de ahora (en la ventana de la sala de espera). */
const appointmentNear = async (input: { conversationId: string; contactId: string | null; phone: string }, now: Date) => {
  const or = [
    { conversationId: input.conversationId },
    ...(input.contactId ? [{ contactId: input.contactId }] : []),
    { phone: { in: whatsAppIdVariants(input.phone) } },
  ];
  return prisma.calendarAppointment.findFirst({
    where: {
      status: "active",
      OR: or,
      startsAt: {
        gte: new Date(now.getTime() - DEFAULT_WAITING.afterMin * 60_000),
        lte: new Date(now.getTime() + DEFAULT_WAITING.beforeMin * 60_000),
      },
    },
    orderBy: { startsAt: "asc" },
  });
};

/** Lo último que Dayana le escribió a esta persona (ni la IA ni un masivo). */
const lastDayanaMessage = async (conversationId: string): Promise<Date | null> => {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId, direction: "OUTBOUND", isAutoReply: false, kind: "message", status: { not: "FAILED" } },
    orderBy: { sentAt: "desc" },
    take: 5,
    select: { sentAt: true, source: true, clientKey: true },
  });
  return rows.find((r) => !isAutoSend(r))?.sentAt ?? null;
};

/** Decide (y si toca, avisa) para una persona y su cita. true si se le mandó el aviso. */
const noticeFor = async (input: {
  config: WhatsAppAiConfig;
  conversationId: string;
  contactId: string | null;
  phone: string;
  name: string | null;
  now: Date;
  triggerMessageId?: string | null;
  /** El reloj solo avisa «está terminando una reunión» (sin que la persona escriba, «ya le aviso» no tiene sentido). */
  onlyBusy?: boolean;
}): Promise<{ sent: boolean; decision: WaitingDecision; holdAi: boolean }> => {
  const appt = await appointmentNear(input, input.now);
  if (!appt) return { sent: false, decision: { kind: "none", reason: "sin cita cerca" }, holdAi: false };
  const booking = await prisma.whatsAppBooking.findFirst({ where: { calendarEventId: appt.eventId }, select: { service: true } });
  const decision = decideWaiting({
    now: input.now,
    appointment: { startsAt: appt.startsAt, endsAt: appt.endsAt, sessionsLabel: appt.sessionsLabel, bookingService: booking?.service ?? null },
    busy: (await busyAround(input.config, input.now, appt.id)).filter((b) => b.start.getTime() !== appt.startsAt.getTime()),
    lastDayanaAt: await lastDayanaMessage(input.conversationId),
    notices: { count: appt.waitNoticeCount, lastAt: appt.waitNoticeAt },
  });
  if (decision.kind === "none") return { sent: false, decision, holdAi: Boolean(decision.holdAi) };
  if (input.onlyBusy && decision.kind !== "busy") return { sent: false, decision, holdAi: false };

  // Reclamo atómico: dos mensajes seguidos de la persona no mandan dos avisos.
  const claimed = await prisma.calendarAppointment.updateMany({
    where: {
      id: appt.id,
      waitNoticeCount: { lt: DEFAULT_WAITING.maxNotices },
      OR: [{ waitNoticeAt: null }, { waitNoticeAt: { lt: new Date(input.now.getTime() - DEFAULT_WAITING.minGapMin * 60_000) } }],
    },
    data: { waitNoticeCount: { increment: 1 }, waitNoticeAt: input.now },
  });
  if (claimed.count === 0) return { sent: false, decision: { kind: "none", reason: "otro proceso ya avisó" }, holdAi: true };

  const body = waitingMessage(decision.kind, appt.name ?? input.name);
  await sendMetaMessage({ conversationId: input.conversationId, body, isAutoReply: true });
  await prisma.whatsAppAiRun.create({
    data: {
      conversationId: input.conversationId,
      status: "REPLIED",
      reason: `waiting_room:${decision.kind}`,
      triggerMessageId: input.triggerMessageId ?? null,
      finishedAt: new Date(),
      latencyMs: 0,
    },
  });
  fireNotification({
    eventType: "WHATSAPP_AI_ESCALATED",
    title: `${appt.name ?? input.name ?? `+${input.phone}`} está esperando su llamada gratis`,
    body:
      decision.kind === "busy"
        ? "Le dije que estás terminando una reunión y que la llamas en unos 5 minutos."
        : "Ya es la hora y le dije que en un momento la llamas.",
    href: `/admin/whatsapp?conversation=${input.conversationId}`,
    entityType: "Conversation",
    entityId: input.conversationId,
    staff: "ALL",
  });
  return { sent: true, decision, holdAi: true };
};

const SILENCING = new Set(["personal", "negocio", "equipo"]);

export const GUARD_SELECT = {
  id: true,
  externalThreadId: true,
  contactId: true,
  participantName: true,
  priorityAt: true,
  lastInboundAt: true,
  aiModeOverride: true,
  aiPausedReason: true,
  aiAlwaysAt: true,
  category: true,
  categorySource: true,
  contact: { select: { firstName: true } },
  dossier: { select: { segment: true } },
} as const;

export type GuardedConversation = {
  externalThreadId: string;
  priorityAt: Date | null;
  aiModeOverride: string | null;
  aiPausedReason: string | null;
  /** «La IA responde siempre» en este chat. */
  aiAlwaysAt?: Date | null;
  category: string | null;
  categorySource: string | null;
  dossier: { segment: string | null } | null;
};

/**
 * Los mismos silencios que respeta la IA: modo general Manual, chat tomado por
 * Dayana o favorito, escalada esperándola, número personal, categoría
 * personal/negocio/equipo puesta a mano, clienta o «no atender».
 */
export const waitingRoomBlocked = async (conv: GuardedConversation, config: WhatsAppAiConfig): Promise<boolean> =>
  // «La IA responde siempre»: solo la calla una escalada que espera a Dayana (una crisis).
  conv.aiAlwaysAt
    ? conv.aiPausedReason === "escalation"
    : config.defaultMode === "MANUAL" ||
      Boolean(conv.priorityAt) ||
      conv.aiModeOverride === "MANUAL" ||
      conv.aiPausedReason === "escalation" ||
      (conv.categorySource === "manual" && SILENCING.has(conv.category ?? "")) ||
      conv.dossier?.segment === "client" ||
      conv.dossier?.segment === "ignored" ||
      (await isIgnoredNumber(conv.externalThreadId));

/**
 * Cuando la persona escribe. `sent`: se le mandó el aviso. `quiet`: es la hora
 * de su llamada gratis: la IA no se pone a conversar (Dayana está por llamarla).
 */
export const handleWaitingRoom = async (input: {
  config: WhatsAppAiConfig;
  conversationId: string;
  triggerMessageId: string;
  now?: Date;
}): Promise<{ sent: boolean; quiet: boolean }> => {
  const none = { sent: false, quiet: false };
  if (!input.config.waitingRoom.enabled) return none;
  const conv = await prisma.conversation.findUnique({ where: { id: input.conversationId }, select: GUARD_SELECT });
  if (!conv || (await waitingRoomBlocked(conv, input.config))) return none;
  const r = await noticeFor({
    config: input.config,
    conversationId: input.conversationId,
    contactId: conv.contactId,
    phone: conv.externalThreadId,
    name: conv.contact?.firstName ?? conv.participantName,
    now: input.now ?? new Date(),
    triggerMessageId: input.triggerMessageId,
  }).catch((e: unknown) => {
    console.warn("[sala de espera] no se pudo revisar", e);
    return { sent: false, holdAi: false };
  });
  return { sent: r.sent, quiet: r.sent || r.holdAi };
};

/** El reloj: a quien ya es su hora y Dayana sigue ocupada, aunque no haya escrito (ventana abierta). */
export const sweepWaitingRoom = async (config: WhatsAppAiConfig, now = new Date()) => {
  if (!config.waitingRoom.enabled || !config.waitingRoom.proactive || !(await isWhatsAppAutoReplyEnabled())) return { off: true };
  const due = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      conversationId: { not: null },
      waitNoticeCount: 0,
      startsAt: { gte: new Date(now.getTime() - 20 * 60_000), lte: new Date(now.getTime() + 2 * 60_000) },
    },
    take: 10,
    select: { conversationId: true },
  });
  let sent = 0;
  for (const a of due) {
    const conv = await prisma.conversation.findUnique({ where: { id: a.conversationId! }, select: GUARD_SELECT });
    // Fuera de la ventana de 24 h haría falta una plantilla: no se manda.
    if (!conv || !conv.lastInboundAt || now.getTime() - conv.lastInboundAt.getTime() > 23.5 * 3600_000) continue;
    if (await waitingRoomBlocked(conv, config)) continue;
    const r = await noticeFor({
      config,
      conversationId: conv.id,
      contactId: conv.contactId,
      phone: conv.externalThreadId,
      name: conv.participantName,
      now,
      onlyBusy: true,
    }).catch(() => ({ sent: false }));
    if (r.sent) sent++;
  }
  return { checked: due.length, sent };
};
