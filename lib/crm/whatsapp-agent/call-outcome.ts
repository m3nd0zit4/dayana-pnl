import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { writeAuditLog } from "../audit";
import { getOperationalTimezone } from "../operational-timezone";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "../whatsapp-ai-config";
import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import {
  checkMessage,
  checkReply,
  FOLLOW_UP_LOOKBACK_DAYS,
  followUpStep,
  MARK_AFTER_START_MIN,
  canChangeOutcome,
  EARLY_CALL_MIN,
  outcomeFromChat,
  planManualMark,
  planOutcomeChange,
  rescheduleMessage,
  rescheduleSendOf,
  type CallOutcome,
  type RescheduleSend,
} from "./call-outcome-rules";
import { personZoneFor } from "./booking-time";
import { isFreeCallAppointment } from "./event-title";
import { latestFreeCallOffer, offerFreeCallSlots, upcomingFreeCall } from "./free-call";
import { slotLabel } from "./free-call-rules";
import { GUARD_SELECT, waitingRoomBlocked } from "./waiting-room";
import { DEFAULT_WAITING } from "./waiting-room-rules";
import { AGREED_MAX_AGE_MS } from "./agreed-time";
import { bookingTurn } from "./booking-turn";
import type { BrainResult } from "./brain";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import { personFirstName } from "@/lib/person-name";
import { dayanaPaymentInfoAt } from "./dayana-messages";
import { appointmentGreetingName } from "./chat-name";

/**
 * Después de la llamada gratis (pedido de la dueña): saber si se hizo y, si
 * la persona no contestó, mandarle el mensaje para reagendar con horas libres.
 * Todo automático: WhatsApp no avisa de las llamadas del celular, así que
 * (reglas en `call-outcome-rules.ts`):
 *
 * 1. Unos minutos después de que termina, se lee el chat. Si dice claramente
 *    que se hizo o que no, queda decidido.
 * 2. Si no dice nada claro, la asistente le pregunta «¿Pudiste hablar con
 *    Dayana?» (solo si la llamada terminó hace menos de 6 h:
 *    `CHECK_MAX_AGE_HOURS`) y su respuesta decide.
 * 3. Si en 24 h no responde, se da por no contestada.
 * 4. Dayana, que ve «Sin respuesta» en su celular, lo marca con un toque
 *    («Hablaron» / «No contestó», `markCallOutcome`) en el chat o en Agenda.
 *
 * Al quedar «no contestada» se le manda el mensaje para reagendar con 2–3
 * horas reales (dentro de las 24 h, como texto; fuera, con la plantilla
 * aprobada). Las horas quedan registradas como ofrecidas: si elige una, la
 * asistente la agenda igual que la primera vez.
 *
 * Respeta los mismos silencios que la IA (modo general Manual, chat tomado,
 * escalada, número personal, clienta…): ahí solo se decide el resultado, no
 * se escribe nada.
 *
 * Lo corren el reloj pegado a los avisos (`tick.ts`, cada ≥ 5 min) y la ruta
 * del cron. Reglas puras (qué hace con cada llamada, la primera vez que corre
 * incluida) en `followUpStep`.
 */

const DAY = 24 * 3600_000;

type Appt = Awaited<ReturnType<typeof prisma.calendarAppointment.findFirst>> & {};

const fmtDay = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);

const loadConversation = (id: string) =>
  prisma.conversation.findUnique({
    where: { id },
    select: {
      ...GUARD_SELECT,
      contact: { select: { firstName: true, timezone: true, countryIso: true, phoneCountryIso: true } },
      dossier: { select: { segment: true, timezone: true } },
    },
  });

type Conv = NonNullable<Awaited<ReturnType<typeof loadConversation>>>;

/**
 * Su zona de verdad: la ficha, el contacto si es de fiar o el país del número
 * (`personZoneFor`). `contacts.timezone` vale Bogotá por defecto: a alguien de
 * México le llegaban las horas de Colombia como si fueran las suyas, con una
 * sola etiqueta (auditoría 21-oct). `null` = no se sabe.
 */
const personZoneOf = (conv: Conv) =>
  personZoneFor({ dossierTz: conv.dossier?.timezone, contact: conv.contact, phone: conv.externalThreadId });

const recipientFor = async (appt: Appt, conv: Conv) =>
  (conv.contactId ? await recipientFromContact(conv.contactId) : null) ?? {
    contactId: conv.contactId,
    phoneE164: `+${appt.phone ?? conv.externalThreadId}`,
    name: appt.name ?? conv.participantName,
    optedOut: false,
  };

/** Solo un nombre seguro (`appointmentGreetingName`): el del chat o el que Dayana escribió en su calendario. */
const nameOf = (appt: Appt, conv: Conv) => appointmentGreetingName({ ...appt, conversationId: appt.conversationId ?? conv.id });

/** ¿Pagó o se inscribió después de la llamada? Entonces sí hablaron. */
const paidAfter = async (appt: Appt, conv: Conv): Promise<boolean> => {
  if (!conv.contactId) return false;
  const [payments, enrollments] = await Promise.all([
    prisma.payment.count({ where: { status: "APPROVED", createdAt: { gte: appt.startsAt }, enrollment: { contactId: conv.contactId } } }),
    prisma.enrollment.count({ where: { contactId: conv.contactId, createdAt: { gte: appt.startsAt }, status: { in: ["ACTIVE", "PENDING_PAYMENT"] } } }),
  ]);
  return payments + enrollments > 0;
};

const PAID_INFO_REASON = "Dayana le mandó cómo pagar: ya hablaron.";

const messagesSince = (conversationId: string, since: Date) =>
  prisma.conversationMessage.findMany({
    where: { conversationId, sentAt: { gte: new Date(since.getTime() - EARLY_CALL_MIN * 60_000) }, kind: "message", status: { not: "FAILED" } },
    orderBy: { sentAt: "asc" },
    take: 200,
    select: { direction: true, body: true, sentAt: true, isAutoReply: true, source: true, clientKey: true },
  });

/**
 * Guarda el resultado una sola vez (si otro proceso ya lo decidió, no hace
 * nada). `source`: chat | asked | timeout | manual (Dayana en el CRM) | rules.
 */
const settle = async (
  apptId: string,
  outcome: CallOutcome | "rescheduled" | "not_free",
  source: "chat" | "asked" | "timeout" | "manual" | "rules",
  reason: string
) =>
  (
    await prisma.calendarAppointment.updateMany({
      where: { id: apptId, callOutcome: null },
      data: { callOutcome: outcome, callOutcomeSource: source, callOutcomeReason: reason.slice(0, 300), callOutcomeAt: new Date() },
    })
  ).count > 0;

const MOVED_REASON = "A la hora de su llamada pidió otra hora y se le mandaron horas para reagendar.";

/**
 * A la hora de su llamada gratis pidió otra hora y la asistente le mandó horas
 * (`run.ts`, Xime 22-oct): esa llamada no va. Queda «no contestó» (chat) con
 * las horas ya enviadas, así no le llega «¿Pudiste hablar con Dayana?» ni otro
 * mensaje de reagendar, y su estado vuelve a ser de quien puede agendar (pasada
 * la hora, una llamada sin resultado contaba como hecha). Solo si nadie la decidió.
 */
export const noteCallMovedInChat = async (appointmentId: string): Promise<boolean> =>
  (
    await prisma.calendarAppointment.updateMany({
      where: { id: appointmentId, callOutcome: null },
      data: { callOutcome: "no_answer", callOutcomeSource: "chat", callOutcomeReason: MOVED_REASON, callOutcomeAt: new Date(), rescheduleSentAt: new Date() },
    })
  ).count > 0;

type ChatReschedule = { kind: "handled" } | { kind: "turn"; turn: BrainResult } | { kind: "hours" };

/**
 * Antes de mandar horas para reagendar, lo que ya quedó en el chat (Xime,
 * 22-oct: a las 9:55 pidió reagendar, la asistente le propuso «mañana viernes
 * 8:00 a. m.», a las 10:18 dijo que sí y a las 10:21 «No contestó» le mandó
 * otras tres horas sin decirle nada de la suya; creyó que tenía llamada el viernes):
 *
 * 1. Ya tiene otra llamada gratis agendada: no se le manda nada.
 * 2. Lo último es de ella (≤ 12 h) y elige de la última lista o acepta la hora
 *    que se le propuso: el turno de agenda del código (`bookingTurn`): la
 *    agenda si está libre o le dice que ya no y le manda las más cercanas.
 * 3. Ya se le mandaron horas desde su hora (se le contestó en la llamada): no
 *    sale otra lista distinta.
 * 4. Si no, las horas de siempre.
 */
const rescheduleFromChat = async (
  appt: Appt,
  conv: Conv,
  config: WhatsAppAiConfig,
  ctx: { now: Date; personTz: string | null; dayanaTz: string }
): Promise<ChatReschedule> => {
  const later = await upcomingFreeCall(conv.id, config, ctx.now).catch(() => null);
  if (later && later.startsAt.getTime() > appt.startsAt.getTime()) return { kind: "handled" };
  if (config.booking.enabled && config.freeCall.controller) {
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: 30,
      select: { direction: true, body: true, sentAt: true, kind: true, status: true, attachments: true, isAutoReply: true, source: true, clientKey: true },
    });
    const last = messages.find((m) => m.kind !== "system" && m.status !== "FAILED");
    if (last?.direction === "INBOUND" && ctx.now.getTime() - last.sentAt.getTime() <= AGREED_MAX_AGE_MS) {
      const sure = await nameOf(appt, conv);
      const turn = await bookingTurn({
        config,
        conversationId: conv.id,
        contactId: conv.contactId,
        phone: conv.externalThreadId,
        firstName: personFirstName(sure) ?? null,
        name: sure ?? appt.name ?? conv.participantName,
        personTz: ctx.personTz,
        dayanaTz: ctx.dayanaTz,
        messages,
        now: ctx.now,
      }).catch((e: unknown) => {
        console.warn("[seguimiento llamada] no se pudo leer lo que acordó en el chat", e instanceof Error ? e.message : e);
        return null;
      });
      if (turn?.outcome.kind === "reply" && turn.outcome.message.trim()) return { kind: "turn", turn };
    }
  }
  const offer = await latestFreeCallOffer(conv.id, ctx.now).catch(() => null);
  if (offer && offer.at.getTime() >= appt.startsAt.getTime() - DEFAULT_WAITING.beforeMin * 60_000) return { kind: "handled" };
  return { kind: "hours" };
};

/** Lo que salió del turno de agenda (agendada a la hora acordada, o las más cercanas), en lugar del mensaje de horas. */
const sendChatTurn = async (
  appt: Appt,
  conv: Conv,
  turn: BrainResult,
  opts: { triggerMessageId?: string | null; notify?: boolean }
): Promise<RescheduleSend> => {
  const text = turn.outcome.kind === "reply" ? turn.outcome.message : "";
  const r = await sendWhatsAppToRecipient({
    recipient: await recipientFor(appt, conv),
    text,
    // Responde a lo que acaba de escribir (≤ 12 h): va como texto. Una plantilla de «no contestó» no diría esto.
    templateKey: null,
    source: `recordatorio:no-contesto:${appt.eventId}`,
    isAutoReply: true,
    clientKey: `noshow:${appt.eventId}`,
  }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));
  const booked = turn.bookingNotice?.label ?? null;
  if (r.status === "sent") {
    await prisma.calendarAppointment.update({ where: { id: appt.id }, data: { rescheduleSentAt: new Date() } });
    // Como lo registra la IA: si es una lista, «1» se agenda por código.
    await prisma.whatsAppAiRun.create({
      data: {
        conversationId: conv.id,
        status: "REPLIED",
        reason: "call_no_answer",
        triggerMessageId: opts.triggerMessageId ?? null,
        toolCalls: turn.toolCalls as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        latencyMs: 0,
      },
    });
  }
  const who = (await nameOf(appt, conv)) ?? `+${appt.phone ?? conv.externalThreadId}`;
  // Agendada y el mensaje no salió: Dayana tiene que saberlo aunque lo haya marcado ella.
  if (opts.notify !== false || (booked && r.status !== "sent")) {
    fireNotification({
      eventType: r.status === "sent" ? "WHATSAPP_AI_INFO" : "WHATSAPP_AI_ESCALATED",
      title: `${who} no contestó la llamada gratis`,
      body:
        r.status === "sent"
          ? booked
            ? `Ya había quedado en el chat con otra hora: quedó agendada para ${booked}.`
            : "La hora que acordó en el chat ya no estaba libre: le mandé las más cercanas."
          : booked
            ? `Quedó agendada para ${booked} (lo acordó en el chat), pero el mensaje no le salió. Escríbele tú.`
            : "El mensaje no salió. Revisa el chat.",
      href: `/admin/whatsapp?conversation=${conv.id}`,
      entityType: "Conversation",
      entityId: conv.id,
      staff: "ALL",
    });
  }
  if (r.status !== "sent") return rescheduleSendOf(r);
  return booked ? { sent: true, booked } : { sent: true };
};

/**
 * El mensaje para reagendar, con horas libres de verdad (en su hora y la de
 * Colombia). Devuelve si salió y, si no, por qué (`needs_template`: pasaron
 * más de 24 h desde su último mensaje y la plantilla no está aprobada;
 * `handled`: en el chat ya quedó con otra hora o ya se le mandaron horas).
 * Lo que acordó en el chat va primero (`rescheduleFromChat`).
 * `notify: false` cuando lo pidió Dayana con un toque: ya lo ve en pantalla.
 */
const sendReschedule = async (
  appt: Appt,
  conv: Conv,
  config: WhatsAppAiConfig,
  opts: { triggerMessageId?: string | null; notify?: boolean } = {}
): Promise<RescheduleSend> => {
  const triggerMessageId = opts.triggerMessageId;
  const dayanaTz = await getOperationalTimezone();
  const personTz = personZoneOf(conv);
  // Lo que ya quedó en el chat manda sobre las horas sueltas (Xime, 22-oct: dijo
  // que sí a «mañana a las 8:00» y este mensaje le mandó otras tres horas).
  const now = new Date();
  const chat = await rescheduleFromChat(appt, conv, config, { now, personTz, dayanaTz });
  if (chat.kind === "handled") return { sent: false, reason: "handled" };
  if (chat.kind === "turn") return sendChatTurn(appt, conv, chat.turn, { triggerMessageId, notify: opts.notify });
  // Con su zona, las dos horas (la suya y la de Colombia); sin saberla, la de
  // Colombia dicha como tal (`slotLabel`). Así quedan también como ofrecidas.
  const options = (
    config.booking.enabled
      ? await offerFreeCallSlots({ config, personTz: personTz ?? dayanaTz, dayanaTz }).catch((e: unknown) => {
          console.warn("[seguimiento llamada] no se pudo leer la agenda", e instanceof Error ? e.message : e);
          return [];
        })
      : []
  ).map((o) => ({ ...o, label: slotLabel(o.startIso, personTz, dayanaTz) }));
  const name = await nameOf(appt, conv);
  const r = await sendWhatsAppToRecipient({
    recipient: await recipientFor(appt, conv),
    text: rescheduleMessage(name, options.map((o) => o.label)),
    templateKey: "cita_no_contestada",
    vars: {
      nombre: personFirstName(name) ?? "",
      fecha: fmtDay(appt.startsAt, personTz ?? dayanaTz),
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
  const result = rescheduleSendOf(r);
  if (opts.notify === false) return result;
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
  return result;
};

/**
 * «¿Pudiste hablar con Dayana?» (una sola vez por cita). Si no llegó a salir
 * (fuera de las 24 h sin la plantilla aprobada, sin número), se suelta la
 * marca: no se le preguntó, así que tampoco puede «no responder» y darse por
 * no contestada; el reloj lo reintenta mientras la llamada sea reciente.
 */
const sendCheck = async (appt: Appt, conv: Conv) => {
  const claimedAt = new Date();
  const claimed = await prisma.calendarAppointment.updateMany({
    where: { id: appt.id, outcomeCheckAt: null, callOutcome: null },
    data: { outcomeCheckAt: claimedAt },
  });
  if (claimed.count === 0) return false;
  const dayanaTz = await getOperationalTimezone();
  const name = await nameOf(appt, conv);
  const r = await sendWhatsAppToRecipient({
    recipient: await recipientFor(appt, conv),
    text: checkMessage(name),
    templateKey: "cita_seguimiento",
    vars: { nombre: personFirstName(name) ?? "", fecha: fmtDay(appt.startsAt, personZoneOf(conv) ?? dayanaTz) },
    source: `recordatorio:seguimiento:${appt.eventId}`,
    isAutoReply: true,
    clientKey: `callcheck:${appt.eventId}`,
  }).catch(() => ({ status: "failed" as const }));
  if (r.status !== "sent") console.warn("[seguimiento llamada] no salió la pregunta", appt.eventId, r.status);
  if (r.status === "skipped") {
    await prisma.calendarAppointment.updateMany({ where: { id: appt.id, outcomeCheckAt: claimedAt }, data: { outcomeCheckAt: null } });
  }
  return r.status === "sent";
};

/** Decide lo que se pueda de una cita y actúa (pregunta o reagenda). */
const advance = async (appt: Appt, config: WhatsAppAiConfig, now: Date, aiEnabled: boolean) => {
  const conv = appt.conversationId ? await loadConversation(appt.conversationId) : null;
  if (!conv) return "sin_chat";
  const booking = await prisma.whatsAppBooking.findFirst({ where: { calendarEventId: appt.eventId }, select: { service: true, createdAt: true } });
  if (!isFreeCallAppointment({ ...appt, bookingService: booking?.service ?? null })) {
    await settle(appt.id, "not_free", "rules", "No es la llamada gratis.");
    return "no_gratis";
  }
  // Dayana le mandó cómo pagar después de agendar: ya hablaron (antes de la
  // hora o por otro lado). Sin «¿pudiste hablar?» ni horas para reagendar
  // (Carmen, Alejandra, Paola, Raquel, 18–21 oct).
  if (await dayanaPaymentInfoAt(conv.id, booking?.createdAt ?? appt.createdAt)) {
    await settle(appt.id, "answered", "rules", PAID_INFO_REASON);
    return "answered";
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
  const next = followUpStep({
    endsAt: appt.endsAt,
    now,
    fromChat,
    checkSentAt: appt.outcomeCheckAt,
    blocked,
    assumeMissedAfterHours: config.callFollowUp.assumeMissedAfterHours,
  });
  switch (next.kind) {
    case "settle":
      if (!(await settle(appt.id, next.outcome, next.source, next.reason))) return "ya_decidida";
      if (next.reschedule) await sendReschedule(appt, conv, config);
      return next.outcome;
    case "ask":
      await sendCheck(appt, conv);
      return "pregunta";
    case "silenced":
      return "silenciado";
    // Terminó hace más de 6 h y el chat no dice nada: no se le pregunta (la
    // primera vez que corre el reloj verá la semana entera); la marca Dayana.
    case "too_old":
      return "antigua";
    case "wait":
      return "esperando";
  }
};

/**
 * El reloj (cada ≥ 5 min, `tick.ts`, y la ruta del cron): las llamadas gratis
 * que ya terminaron y aún no se sabe si se hicieron. Las más recientes primero:
 * las viejas sin decidir (para Dayana) no quitan turno a las de hoy.
 */
export const sweepCallOutcomes = async (config: WhatsAppAiConfig, now = new Date()) => {
  if (!config.callFollowUp.enabled) return { off: true };
  const due = await prisma.calendarAppointment.findMany({
    where: {
      status: "active",
      callOutcome: null,
      conversationId: { not: null },
      endsAt: {
        lte: new Date(now.getTime() - config.callFollowUp.askAfterMin * 60_000),
        gte: new Date(now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY),
      },
    },
    orderBy: { endsAt: "desc" },
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
  const booking = await prisma.whatsAppBooking.findFirst({ where: { calendarEventId: appt.eventId }, select: { service: true, createdAt: true } });
  if (!isFreeCallAppointment({ ...appt, bookingService: booking?.service ?? null })) return none;
  if (await dayanaPaymentInfoAt(conv.id, booking?.createdAt ?? appt.createdAt)) {
    await settle(appt.id, "answered", "rules", PAID_INFO_REASON);
    return none;
  }

  const messages = await messagesSince(conv.id, appt.startsAt);
  let decided = outcomeFromChat(messages, { startsAt: appt.startsAt, paidAfter: await paidAfter(appt, conv) });
  let source: "chat" | "asked" = "chat";
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
  return { handled: (await sendReschedule(appt, conv, input.config, { triggerMessageId: input.triggerMessageId })).sent };
};

/** La reserva de la IA (si la agendó ella) dice el servicio: con eso se sabe si es la llamada gratis. */
const isFreeCall = async (appt: Appt) => {
  const booking = await prisma.whatsAppBooking.findFirst({ where: { calendarEventId: appt.eventId }, select: { service: true } });
  return isFreeCallAppointment({ ...appt, bookingService: booking?.service ?? null });
};

/**
 * La llamada gratis de este chat a la que le falta saber cómo terminó (para la
 * barra «¿Cómo terminó la llamada gratis…?» encima de la caja de escribir):
 * empezó hace 5 min o más, terminó en los últimos 7 días, sin resultado y sin
 * otra llamada gratis agendada después. `asked`: la asistente ya le preguntó
 * «¿Pudiste hablar con Dayana?» (el mensaje salió).
 */
export const findCallToMark = async (
  conversationId: string,
  now = new Date()
): Promise<{ appointmentId: string; startsAt: Date; asked: boolean } | null> => {
  const rows = await prisma.calendarAppointment.findMany({
    where: {
      conversationId,
      status: "active",
      callOutcome: null,
      startsAt: { lte: new Date(now.getTime() - MARK_AFTER_START_MIN * 60_000) },
      endsAt: { gte: new Date(now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY) },
    },
    orderBy: { startsAt: "desc" },
    take: 5,
  });
  if (rows.length === 0) return null;
  const bookings = await prisma.whatsAppBooking.findMany({
    where: { calendarEventId: { in: rows.map((r) => r.eventId) } },
    select: { calendarEventId: true, service: true },
  });
  const appt = rows.find((r) =>
    isFreeCallAppointment({ ...r, bookingService: bookings.find((b) => b.calendarEventId === r.eventId)?.service ?? null })
  );
  if (!appt) return null;
  const later = await prisma.calendarAppointment.findFirst({
    where: { id: { not: appt.id }, conversationId, status: "active", startsAt: { gt: appt.startsAt } },
    select: { startsAt: true, endsAt: true, sessionsLabel: true },
  });
  // Ya tiene otra llamada gratis agendada: se reagendó (el reloj lo deja así).
  if (later && isFreeCallAppointment(later)) return null;
  const asked = await prisma.conversationMessage.count({
    where: { conversationId, clientKey: `callcheck:${appt.eventId}`, status: { not: "FAILED" } },
  });
  return { appointmentId: appt.id, startsAt: appt.startsAt, asked: asked > 0 };
};

export type MarkCallOutcomeResult =
  | {
      ok: true;
      outcome: CallOutcome;
      /** Salió el mensaje para reagendar (solo con «no contestó»). */
      sent: boolean;
      /** Ya había quedado en el chat con otra hora: quedó agendada para esta (la etiqueta). */
      booked?: string;
      /**
       * Por qué no salió: `needs_template` (su último mensaje fue hace más de
       * 24 h y la plantilla «Llamada gratis: no contestó» no está aprobada),
       * `silenced` (la asistente no escribe en este chat), `handled` (en el
       * chat ya tiene otra llamada o ya se le mandaron horas), `failed`.
       */
      reason?: "needs_template" | "silenced" | "failed" | "handled";
    }
  | { ok: false; error: "not_found" | "not_free" | "not_yet" | "already_decided" };

/**
 * Dayana marca con un toque cómo terminó la llamada gratis (WhatsApp no avisa
 * de las llamadas del celular: ella sí ve «Sin respuesta»). Queda con origen
 * `manual`, solo si aún no estaba decidida. «No contestó» le manda enseguida el
 * mensaje para reagendar con horas libres (que quedan ofrecidas), salvo que el
 * chat esté en silencio para la asistente.
 */
export const markCallOutcome = async (input: {
  appointmentId: string;
  outcome: CallOutcome;
  staffUserId?: string | null;
  /** «No contestó» sin mensaje (Dayana ya le escribió). Por defecto se le mandan horas. */
  sendHours?: boolean;
  now?: Date;
}): Promise<MarkCallOutcomeResult> => {
  const now = input.now ?? new Date();
  const appt = await prisma.calendarAppointment.findUnique({ where: { id: input.appointmentId } });
  if (!appt || appt.status !== "active") return { ok: false, error: "not_found" };
  if (appt.callOutcome !== null) return { ok: false, error: "already_decided" };
  if (!(await isFreeCall(appt))) return { ok: false, error: "not_free" };

  const [conv, config] = await Promise.all([
    appt.conversationId ? loadConversation(appt.conversationId) : Promise.resolve(null),
    getWhatsAppAiConfig(),
  ]);
  const plan = planManualMark({
    callOutcome: appt.callOutcome,
    startsAt: appt.startsAt,
    now,
    outcome: input.outcome,
    blocked: conv ? await waitingRoomBlocked(conv, config) : false,
    sendHours: input.sendHours,
  });
  if (plan.kind !== "settle") return { ok: false, error: plan.kind };
  if (!(await settle(appt.id, plan.outcome, "manual", plan.reason))) return { ok: false, error: "already_decided" };

  let result: Extract<MarkCallOutcomeResult, { ok: true }> = { ok: true, outcome: plan.outcome, sent: false };
  if (plan.send === "silenced") result = { ...result, reason: "silenced" };
  else if (plan.send === "reschedule") {
    const r: RescheduleSend = conv
      ? await sendReschedule(appt, conv, config, { notify: false })
      : { sent: false, reason: "failed" };
    result = r.sent ? { ...result, sent: true, ...(r.booked ? { booked: r.booked } : {}) } : { ...result, reason: r.reason };
  }
  await writeAuditLog({
    staffUserId: input.staffUserId ?? undefined,
    action: "whatsapp.call_outcome.mark",
    entityType: "CalendarAppointment",
    entityId: appt.id,
    changes: { outcome: plan.outcome, conversationId: appt.conversationId, sent: result.sent, reason: result.reason ?? null },
  }).catch(() => undefined);
  return result;
};

export type ChangeCallOutcomeResult =
  | { ok: true; outcome: CallOutcome; sent: boolean; booked?: string; reason?: "needs_template" | "silenced" | "failed" | "handled" }
  | { ok: false; error: "not_found" | "not_changeable" | "same" | "changed_meanwhile" };

/**
 * Dayana corrige cómo terminó una llamada gratis ya marcada («Hablaron» ↔ «No
 * contestó»; reglas en `planOutcomeChange`). Queda con origen `manual` y la
 * hora del cambio (así el estado de la persona se recalcula). Solo cambia si
 * nadie lo cambió entre medio. A «No contestó» con `sendHours` le manda horas
 * para reagendar si no se le mandaron ya.
 */
export const changeCallOutcome = async (input: {
  appointmentId: string;
  outcome: CallOutcome;
  sendHours: boolean;
  staffUserId?: string | null;
  now?: Date;
}): Promise<ChangeCallOutcomeResult> => {
  const now = input.now ?? new Date();
  const appt = await prisma.calendarAppointment.findUnique({ where: { id: input.appointmentId } });
  if (!appt || !canChangeOutcome(appt, now)) {
    return { ok: false, error: appt && appt.status === "active" ? "not_changeable" : "not_found" };
  }
  const [conv, config] = await Promise.all([
    appt.conversationId ? loadConversation(appt.conversationId) : Promise.resolve(null),
    getWhatsAppAiConfig(),
  ]);
  const plan = planOutcomeChange({
    current: appt.callOutcome,
    outcome: input.outcome,
    sendHours: input.sendHours,
    rescheduleSent: Boolean(appt.rescheduleSentAt),
    blocked: conv ? await waitingRoomBlocked(conv, config) : false,
  });
  if (plan.kind !== "change") return { ok: false, error: plan.kind };
  const updated = await prisma.calendarAppointment.updateMany({
    where: { id: appt.id, callOutcome: appt.callOutcome },
    data: { callOutcome: plan.outcome, callOutcomeSource: "manual", callOutcomeReason: plan.reason, callOutcomeAt: now },
  });
  if (updated.count === 0) return { ok: false, error: "changed_meanwhile" };

  let result: Extract<ChangeCallOutcomeResult, { ok: true }> = { ok: true, outcome: plan.outcome, sent: false };
  if (plan.send === "silenced") result = { ...result, reason: "silenced" };
  else if (plan.send === "reschedule") {
    const r: RescheduleSend = conv ? await sendReschedule(appt, conv, config, { notify: false }) : { sent: false, reason: "failed" };
    result = r.sent ? { ...result, sent: true, ...(r.booked ? { booked: r.booked } : {}) } : { ...result, reason: r.reason };
  }
  await writeAuditLog({
    staffUserId: input.staffUserId ?? undefined,
    action: "whatsapp.call_outcome.change",
    entityType: "CalendarAppointment",
    entityId: appt.id,
    changes: {
      from: appt.callOutcome,
      fromSource: appt.callOutcomeSource,
      to: plan.outcome,
      conversationId: appt.conversationId,
      sent: result.sent,
      reason: result.reason ?? null,
    },
  }).catch(() => undefined);
  return result;
};

/**
 * La llamada gratis de este chat que ya tiene resultado y se marcó hace poco
 * (en las últimas `withinHours`): encima de la caja de escribir sale «Llamada
 * gratis de ayer, 7:15 p. m.: Hablaron · Cambiar», para corregir un toque
 * equivocado sin ir a Agenda.
 */
export const findDecidedCall = async (
  conversationId: string,
  now = new Date(),
  withinHours = 24
): Promise<{
  appointmentId: string;
  startsAt: Date;
  outcome: CallOutcome;
  source: string | null;
  rescheduleSent: boolean;
} | null> => {
  const appt = await prisma.calendarAppointment.findFirst({
    where: {
      conversationId,
      status: "active",
      callOutcome: { in: ["answered", "no_answer"] },
      callOutcomeAt: { gte: new Date(now.getTime() - withinHours * 3600_000) },
      endsAt: { gte: new Date(now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY) },
    },
    orderBy: { startsAt: "desc" },
  });
  if (!appt || !(await isFreeCall(appt))) return null;
  return {
    appointmentId: appt.id,
    startsAt: appt.startsAt,
    outcome: appt.callOutcome as CallOutcome,
    source: appt.callOutcomeSource,
    rescheduleSent: Boolean(appt.rescheduleSentAt),
  };
};
