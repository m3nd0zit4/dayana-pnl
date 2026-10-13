import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getOperationalTimezone } from "../operational-timezone";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import { checkMessage, checkReply, outcomeFromChat, rescheduleMessage, type CallOutcome } from "./call-outcome-rules";
import { isFreeCallAppointment } from "./event-title";
import { offerFreeCallSlots } from "./free-call";
import { GUARD_SELECT, waitingRoomBlocked } from "./waiting-room";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";

/**
 * Después de la llamada gratis (pedido de la dueña): saber si se hizo y, si
 * la persona no contestó, mandarle el mensaje para reagendar con horas libres.
 * Todo automático: WhatsApp no avisa de las llamadas del celular, así que
 * (reglas en `call-outcome-rules.ts`):
 *
 * 1. Unos minutos después de que termina, se lee el chat. Si dice claramente
 *    que se hizo o que no, queda decidido.
 * 2. Si no dice nada claro, la asistente le pregunta «¿Pudiste hablar con
 *    Dayana?» y su respuesta decide.
 * 3. Si en 24 h no responde, se da por no contestada.
 *
 * Al quedar «no contestada» se le manda el mensaje para reagendar con 2–3
 * horas reales (dentro de las 24 h, como texto; fuera, con la plantilla
 * aprobada). Las horas quedan registradas como ofrecidas: si elige una, la
 * asistente la agenda igual que la primera vez.
 *
 * Respeta los mismos silencios que la IA (modo general Manual, chat tomado,
 * escalada, número personal, clienta…): ahí solo se decide el resultado, no
 * se escribe nada.
 */

const DAY = 24 * 3600_000;

type Appt = Awaited<ReturnType<typeof prisma.calendarAppointment.findFirst>> & {};

const fmtDay = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);

const loadConversation = (id: string) =>
  prisma.conversation.findUnique({
    where: { id },
    select: { ...GUARD_SELECT, contact: { select: { firstName: true, timezone: true } }, dossier: { select: { segment: true, timezone: true } } },
  });

type Conv = NonNullable<Awaited<ReturnType<typeof loadConversation>>>;

const recipientFor = async (appt: Appt, conv: Conv) =>
  (conv.contactId ? await recipientFromContact(conv.contactId) : null) ?? {
    contactId: conv.contactId,
    phoneE164: `+${appt.phone ?? conv.externalThreadId}`,
    name: appt.name ?? conv.participantName,
    optedOut: false,
  };

const nameOf = (appt: Appt, conv: Conv) => appt.name ?? conv.contact?.firstName ?? conv.participantName;

/** ¿Pagó o se inscribió después de la llamada? Entonces sí hablaron. */
const paidAfter = async (appt: Appt, conv: Conv): Promise<boolean> => {
  if (!conv.contactId) return false;
  const [payments, enrollments] = await Promise.all([
    prisma.payment.count({ where: { status: "APPROVED", createdAt: { gte: appt.startsAt }, enrollment: { contactId: conv.contactId } } }),
    prisma.enrollment.count({ where: { contactId: conv.contactId, createdAt: { gte: appt.startsAt }, status: { in: ["ACTIVE", "PENDING_PAYMENT"] } } }),
  ]);
  return payments + enrollments > 0;
};

const messagesSince = (conversationId: string, since: Date) =>
  prisma.conversationMessage.findMany({
    where: { conversationId, sentAt: { gte: new Date(since.getTime() - 15 * 60_000) }, kind: "message", status: { not: "FAILED" } },
    orderBy: { sentAt: "asc" },
    take: 200,
    select: { direction: true, body: true, sentAt: true, isAutoReply: true, source: true, clientKey: true },
  });

/** Guarda el resultado una sola vez (si otro proceso ya lo decidió, no hace nada). */
const settle = async (apptId: string, outcome: CallOutcome | "rescheduled" | "not_free", source: string, reason: string) =>
  (
    await prisma.calendarAppointment.updateMany({
      where: { id: apptId, callOutcome: null },
      data: { callOutcome: outcome, callOutcomeSource: source, callOutcomeReason: reason.slice(0, 300), callOutcomeAt: new Date() },
    })
  ).count > 0;

/** El mensaje para reagendar, con horas libres de verdad (en su hora y la de Colombia). */
const sendReschedule = async (appt: Appt, conv: Conv, config: WhatsAppAiConfig, triggerMessageId?: string | null) => {
  const dayanaTz = await getOperationalTimezone();
  const personTz = conv.dossier?.timezone ?? conv.contact?.timezone ?? dayanaTz;
  const options = config.booking.enabled
    ? await offerFreeCallSlots({ config, personTz, dayanaTz }).catch((e: unknown) => {
        console.warn("[seguimiento llamada] no se pudo leer la agenda", e instanceof Error ? e.message : e);
        return [];
      })
    : [];
  const name = nameOf(appt, conv);
  const r = await sendWhatsAppToRecipient({
    recipient: await recipientFor(appt, conv),
    text: rescheduleMessage(name, options.map((o) => o.label)),
    templateKey: "cita_no_contestada",
    vars: {
      nombre: name?.split(/\s+/)[0] ?? "",
      fecha: fmtDay(appt.startsAt, personTz),
      horarios: options.length ? options.map((o) => o.label).join(" · ") : "escríbenos qué día y hora te quedan bien",
    },
    // `recordatorio:`: sale solo, no cuenta como que Dayana contestó.
    source: `recordatorio:no-contesto:${appt.eventId}`,
    isAutoReply: true,
    clientKey: `noshow:${appt.eventId}`,
  }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

  if (r.status === "sent") {
    await prisma.calendarAppointment.update({ where: { id: appt.id }, data: { rescheduleSentAt: new Date() } });
    // Las horas quedan como ofrecidas: si elige una, la asistente la agenda.
    await prisma.whatsAppAiRun.create({
      data: {
        conversationId: conv.id,
        status: "REPLIED",
        reason: "call_no_answer",
        triggerMessageId: triggerMessageId ?? null,
        toolCalls: [{ tool: "offer_free_call_slots", input: {}, output: { ok: true, options } }] as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        latencyMs: 0,
      },
    });
  }
  fireNotification({
    eventType: r.status === "sent" ? "WHATSAPP_AI_INFO" : "WHATSAPP_AI_ESCALATED",
    title:
      r.status === "sent"
        ? `${name ?? `+${appt.phone}`} no contestó la llamada gratis`
        : `No pude escribirle a ${name ?? `+${appt.phone}`} para reagendar`,
    body:
      r.status === "sent"
        ? `Le mandé ${options.length} horas para reagendar.`
        : r.status === "skipped" && r.reason === "needs_template"
          ? "Pasaron más de 24 h desde su último mensaje: falta aprobar la plantilla «Llamada gratis: no contestó» (WhatsApp → Plantillas)."
          : "El mensaje no salió. Revisa el chat.",
    href: `/admin/whatsapp?conversation=${conv.id}`,
    entityType: "Conversation",
    entityId: conv.id,
    staff: "ALL",
  });
  return r.status === "sent";
};

/** «¿Pudiste hablar con Dayana?» (una sola vez por cita). */
const sendCheck = async (appt: Appt, conv: Conv) => {
  const claimed = await prisma.calendarAppointment.updateMany({
    where: { id: appt.id, outcomeCheckAt: null, callOutcome: null },
    data: { outcomeCheckAt: new Date() },
  });
  if (claimed.count === 0) return false;
  const dayanaTz = await getOperationalTimezone();
  const name = nameOf(appt, conv);
  const r = await sendWhatsAppToRecipient({
    recipient: await recipientFor(appt, conv),
    text: checkMessage(name),
    templateKey: "cita_seguimiento",
    vars: { nombre: name?.split(/\s+/)[0] ?? "", fecha: fmtDay(appt.startsAt, conv.dossier?.timezone ?? conv.contact?.timezone ?? dayanaTz) },
    source: `recordatorio:seguimiento:${appt.eventId}`,
    isAutoReply: true,
    clientKey: `callcheck:${appt.eventId}`,
  }).catch(() => ({ status: "failed" as const }));
  if (r.status !== "sent") console.warn("[seguimiento llamada] no salió la pregunta", appt.eventId, r.status);
  return r.status === "sent";
};

/** Decide lo que se pueda de una cita y actúa (pregunta o reagenda). */
const advance = async (appt: Appt, config: WhatsAppAiConfig, now: Date, aiEnabled: boolean) => {
  const conv = appt.conversationId ? await loadConversation(appt.conversationId) : null;
  if (!conv) return "sin_chat";
  const booking = await prisma.whatsAppBooking.findFirst({ where: { calendarEventId: appt.eventId }, select: { service: true } });
  if (!isFreeCallAppointment({ ...appt, bookingService: booking?.service ?? null })) {
    await settle(appt.id, "not_free", "rules", "No es la llamada gratis.");
    return "no_gratis";
  }
  // Ya tiene otra llamada gratis agendada después: se reagendó.
  const later = await prisma.calendarAppointment.findFirst({
    where: { id: { not: appt.id }, conversationId: conv.id, status: "active", startsAt: { gt: appt.startsAt } },
    select: { startsAt: true, endsAt: true, sessionsLabel: true },
  });
  if (later && isFreeCallAppointment(later)) {
    await settle(appt.id, "rescheduled", "rules", "Ya tiene otra llamada gratis agendada.");
    return "reagendada";
  }

  // Con la IA apagada o un silencio del chat, solo se decide: no se escribe nada.
  const blocked = !aiEnabled || (await waitingRoomBlocked(conv, config));
  const fromChat = outcomeFromChat(await messagesSince(conv.id, appt.startsAt), {
    startsAt: appt.startsAt,
    paidAfter: await paidAfter(appt, conv),
  });
  if (fromChat) {
    if (!(await settle(appt.id, fromChat.outcome, "chat", fromChat.reason))) return "ya_decidida";
    if (fromChat.outcome === "no_answer" && !blocked) await sendReschedule(appt, conv, config);
    return fromChat.outcome;
  }
  if (blocked) return "silenciado";
  if (!appt.outcomeCheckAt) {
    await sendCheck(appt, conv);
    return "pregunta";
  }
  if (now.getTime() - appt.outcomeCheckAt.getTime() >= config.callFollowUp.assumeMissedAfterHours * 3600_000) {
    if (await settle(appt.id, "no_answer", "timeout", `Sin respuesta en ${config.callFollowUp.assumeMissedAfterHours} h.`)) {
      await sendReschedule(appt, conv, config);
    }
    return "no_answer";
  }
  return "esperando";
};

/** El reloj (cada 10 min): las llamadas gratis que ya terminaron y aún no se sabe si se hicieron. */
export const sweepCallOutcomes = async (config: WhatsAppAiConfig, now = new Date()) => {
  if (!config.callFollowUp.enabled) return { off: true };
  const due = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      callOutcome: null,
      conversationId: { not: null },
      endsAt: { lte: new Date(now.getTime() - config.callFollowUp.askAfterMin * 60_000), gte: new Date(now.getTime() - 7 * DAY) },
    },
    orderBy: { endsAt: "asc" },
    take: 20,
  });
  const out: Record<string, number> = {};
  const aiEnabled = await isWhatsAppAutoReplyEnabled();
  for (const appt of due) {
    const r = await advance(appt, config, now, aiEnabled).catch((e: unknown) => {
      console.warn("[seguimiento llamada] no se pudo revisar", appt.id, e);
      return "error";
    });
    out[r] = (out[r] ?? 0) + 1;
  }
  return { checked: due.length, ...out };
};

/**
 * Cuando la persona escribe después de su llamada gratis: lo que diga puede
 * decidir el resultado («no me llamaron», o la respuesta a «¿pudiste
 * hablar?»). `handled`: se le mandó el mensaje para reagendar (la IA no
 * contesta encima).
 */
export const handleCallFollowUpReply = async (input: {
  config: WhatsAppAiConfig;
  conversationId: string;
  triggerMessageId: string;
  now?: Date;
}): Promise<{ handled: boolean }> => {
  const none = { handled: false };
  if (!input.config.callFollowUp.enabled) return none;
  const now = input.now ?? new Date();
  const appt = await prisma.calendarAppointment.findFirst({
    where: { conversationId: input.conversationId, status: "active", callOutcome: null, endsAt: { lt: now, gte: new Date(now.getTime() - 7 * DAY) } },
    orderBy: { startsAt: "desc" },
  });
  if (!appt) return none;
  const conv = await loadConversation(input.conversationId);
  if (!conv) return none;
  const booking = await prisma.whatsAppBooking.findFirst({ where: { calendarEventId: appt.eventId }, select: { service: true } });
  if (!isFreeCallAppointment({ ...appt, bookingService: booking?.service ?? null })) return none;

  const messages = await messagesSince(conv.id, appt.startsAt);
  let decided = outcomeFromChat(messages, { startsAt: appt.startsAt, paidAfter: await paidAfter(appt, conv) });
  let source = "chat";
  if (!decided && appt.outcomeCheckAt) {
    // Lo que respondió a la pregunta (lo que escribió después de preguntarle).
    const reply = messages
      .filter((m) => m.direction === "INBOUND" && m.sentAt >= appt.outcomeCheckAt!)
      .map((m) => m.body ?? "")
      .join(" ");
    const answer = reply ? checkReply(reply) : null;
    if (answer) {
      decided = { outcome: answer, reason: answer === "answered" ? "Respondió que sí habló con Dayana." : "Respondió que no pudo hablar con Dayana." };
      source = "asked";
    }
  }
  if (!decided) return none;
  if (!(await settle(appt.id, decided.outcome, source, decided.reason))) return none;
  if (decided.outcome === "answered" || (await waitingRoomBlocked(conv, input.config))) return none;
  return { handled: await sendReschedule(appt, conv, input.config, input.triggerMessageId) };
};
