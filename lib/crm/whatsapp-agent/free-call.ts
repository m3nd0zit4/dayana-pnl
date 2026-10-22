import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getDateKeyInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { isWhatsAppUserId, whatsAppDigits, whatsAppIdVariants } from "@/lib/whatsapp-contact";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { availableSlots, bookOnCalendar, moveOnCalendar, SlotUnavailableError } from "./calendar";
import { isFreeCallService } from "./event-title";
import {
  CANCELLED_BOOKING,
  countedFreeCalls,
  dualZoneLabel,
  freeCallsPerDay,
  pickUpcomingFreeCall,
  respiroRange,
  type UpcomingFreeCall,
} from "./free-call-rules";
import { resolveConversations } from "./pending";
import { hasWish, matchesWish, pickFreeCallSlots, relaxedWishes, type SlotWish, type WishStep } from "./slots";

/**
 * La llamada gratis de 15 minutos: el único objetivo de la asistente con una
 * persona nueva. Dayana la hace por WhatsApp (no hay enlace de Meet).
 *
 * - `offerFreeCallSlots`: 2–3 horas libres de verdad del calendario de Dayana
 *   (los bloques «Disponible», o su horario base), repartidas en días, con la
 *   hora de la persona y la de Colombia.
 * - `bookFreeCall`: agenda una de esas horas. Con un candado de base de datos
 *   para que dos personas no se queden con la misma hora (ni pegadas, sin el
 *   respiro), vuelve a mirar el calendario, no agenda dos llamadas gratis a la
 *   misma persona y respeta el tope diario. Deja la cita en el calendario y en
 *   el CRM al instante.
 *
 * Qué cuenta como llamada gratis (la reserva de la IA o la que Dayana puso a
 * mano en su calendario) está en `free-call-rules.ts`.
 */

export type FreeCallService = { name: string; minutes: number };

/**
 * Para las pruebas: un calendario de mentira (las pruebas nunca deben crear
 * eventos en el calendario real de Dayana).
 */
type CalendarDeps = { available?: typeof availableSlots; book?: typeof bookOnCalendar; move?: typeof moveOnCalendar };
let calendarDeps: CalendarDeps = {};
export const setFreeCallCalendarForTests = (deps: CalendarDeps) => {
  calendarDeps = deps;
};

/** El servicio de la llamada gratis (el de Ajustes; si no, el primero que sea gratis). */
export const freeCallService = (config: WhatsAppAiConfig): FreeCallService => {
  const wanted = config.freeCall.serviceName.trim().toLowerCase();
  const byName = config.booking.services.find((s) => s.name.trim().toLowerCase() === wanted);
  const free = byName ?? config.booking.services.find((s) => isFreeCallService(s.name, s.minutes));
  return free ? { name: free.name, minutes: free.minutes } : { name: config.freeCall.serviceName, minutes: 15 };
};

// Vive en las reglas (es pura); se sigue importando de aquí.
export { dualZoneLabel };

export type FreeCallOption = { startIso: string; label: string };

/** El día de `d` en la zona de Dayana (de medianoche a medianoche), para el tope diario. */
const dayBounds = (d: Date, tz: string): { from: Date; to: Date } => {
  const from = zonedDateTimeToUtc(getDateKeyInTz(d, tz), "00:00", tz);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
};


/** La base o la transacción del candado: las reservas se cuentan dentro de él. */
type Db = Pick<typeof prisma, "whatsAppBooking" | "calendarAppointment">;

const BOOKING_ROW = { id: true, service: true, startsAt: true, endsAt: true, meetUrl: true, status: true, calendarEventId: true } as const;
const CALENDAR_ROW = {
  id: true,
  eventId: true,
  title: true,
  sessionsLabel: true,
  meetUrl: true,
  startsAt: true,
  endsAt: true,
  phone: true,
  contactId: true,
  conversationId: true,
} as const;

/**
 * Las llamadas gratis entre dos instantes, una por evento: las reservas de la
 * IA y las que Dayana puso a mano en su calendario (auditoría 21-oct: esas no
 * contaban en el tope del día). `except`: la llamada que se está moviendo.
 * Una consulta tras otra: dentro de la transacción no van en paralelo.
 */
const freeCallsBetween = async (
  db: Db,
  service: FreeCallService,
  from: Date,
  to: Date,
  except?: { bookingId: string; eventId: string }
) => {
  const bookings = await db.whatsAppBooking.findMany({
    where: { startsAt: { gte: from, lt: to }, status: { notIn: CANCELLED_BOOKING }, ...(except ? { id: { not: except.bookingId } } : {}) },
    select: BOOKING_ROW,
  });
  const appointments = await db.calendarAppointment.findMany({
    where: { startsAt: { gte: from, lt: to }, status: "active", ...(except ? { eventId: { not: except.eventId } } : {}) },
    select: CALENDAR_ROW,
  });
  return countedFreeCalls({ bookings, appointments, service });
};

/** Los días (zona de Dayana) que ya tienen el tope de llamadas gratis. */
const fullFreeCallDays = async (config: WhatsAppAiConfig, dayanaTz: string, now: Date): Promise<Set<string>> => {
  // Desde la medianoche de hoy, como cuenta `bookFreeCall`: con «desde ahora»
  // las llamadas de esta mañana no contaban, se ofrecían horas de hoy y al
  // agendar salía «Ese día ya no hay cupos» (Natalia, Barbara, Alexandra, 21-oct).
  const calls = await freeCallsBetween(
    prisma,
    freeCallService(config),
    dayBounds(now, dayanaTz).from,
    new Date(now.getTime() + (config.booking.horizonDays + 1) * 86_400_000)
  );
  return new Set([...freeCallsPerDay(calls, dayanaTz)].filter(([, n]) => n >= config.freeCall.maxPerDay).map(([k]) => k));
};

/**
 * Las horas para ofrecer: hoy o mañana primero, luego los días preferidos de
 * Dayana, luego el resto (`pickFreeCallSlots`). Con `wish` (lo que la persona
 * dijo que puede) solo las que le sirven; si ninguna le sirve, las de siempre
 * y `matchedWish: false` para que la asistente se lo diga.
 */
export const offerFreeCallSlotsFor = async (input: {
  config: WhatsAppAiConfig;
  personTz: string;
  dayanaTz: string;
  now?: Date;
  wish?: SlotWish | null;
}): Promise<{ options: FreeCallOption[]; matchedWish: boolean | null; closest?: WishStep }> => {
  const now = input.now ?? new Date();
  const service = freeCallService(input.config);
  const [slots, fullDays] = await Promise.all([
    (calendarDeps.available ?? availableSlots)({
      config: input.config.booking,
      durationMin: service.minutes,
      timezone: input.dayanaTz,
      now,
      // Todo el horizonte: con 40 se quedaba en los primeros días y los
      // preferidos de la otra semana nunca salían.
      limit: 2000,
    }),
    fullFreeCallDays(input.config, input.dayanaTz, now).catch(() => new Set<string>()),
  ]);
  const pick = (from: typeof slots) =>
    pickFreeCallSlots(from, {
      count: input.config.freeCall.offer,
      timezone: input.dayanaTz,
      now,
      soonFirst: input.config.freeCall.soonFirst,
      preferredWeekdays: input.config.freeCall.preferredWeekdays,
      fullDays,
    });
  const label = (s: (typeof slots)[number]) => ({ startIso: s.startIso, label: dualZoneLabel(s.startIso, input.personTz, input.dayanaTz) });
  if (hasWish(input.wish)) {
    for (const { step, wish } of relaxedWishes(input.wish)) {
      const found = pick(slots.filter((s) => matchesWish(s, wish, input.personTz)));
      if (found.length > 0) return { options: found.map(label), matchedWish: step === "exact", ...(step === "exact" ? {} : { closest: step }) };
    }
    return { options: [], matchedWish: false, closest: "any" };
  }
  return { options: pick(slots).map(label), matchedWish: null };
};

export const offerFreeCallSlots = async (input: {
  config: WhatsAppAiConfig;
  personTz: string;
  dayanaTz: string;
  now?: Date;
}): Promise<FreeCallOption[]> => (await offerFreeCallSlotsFor(input)).options;

/** Las horas que la asistente ya le ofreció a esta persona (últimas 72 h): solo esas se agendan. */
export const offeredFreeCallSlots = async (conversationId: string, now = new Date()): Promise<string[]> => {
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, queuedAt: { gte: new Date(now.getTime() - 72 * 3600_000) } },
    orderBy: { queuedAt: "desc" },
    take: 30,
    select: { toolCalls: true, status: true },
  });
  const out = new Set<string>();
  for (const r of runs) {
    // Una propuesta que Dayana canceló no se ofreció.
    if (r.status === "CANCELLED") continue;
    for (const call of (Array.isArray(r.toolCalls) ? r.toolCalls : []) as { tool?: string; output?: { options?: FreeCallOption[] } }[]) {
      if (call.tool === "offer_free_call_slots") for (const o of call.output?.options ?? []) out.add(new Date(o.startIso).toISOString());
    }
  }
  return [...out];
};

/**
 * La última lista de horas que recibió (la IA, el controlador de agenda o el
 * mensaje de reagendar), en el orden en que salió: «la 2» es su 2. Últimas 72 h.
 */
export const latestFreeCallOffer = async (
  conversationId: string,
  now = new Date()
): Promise<{ at: Date; options: FreeCallOption[] } | null> => {
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, queuedAt: { gte: new Date(now.getTime() - 72 * 3600_000) } },
    orderBy: { queuedAt: "desc" },
    take: 30,
    select: { toolCalls: true, status: true, queuedAt: true },
  });
  for (const r of runs) {
    if (r.status === "CANCELLED") continue;
    const calls = (Array.isArray(r.toolCalls) ? r.toolCalls : []) as { tool?: string; output?: { ok?: boolean; options?: FreeCallOption[] } }[];
    const offer = calls.findLast((c) => c.tool === "offer_free_call_slots" && c.output?.options?.length);
    if (offer?.output?.options) return { at: r.queuedAt, options: offer.output.options };
  }
  return null;
};

export class FreeCallError extends Error {
  constructor(public code: "already_booked" | "daily_cap" | "unavailable" | "not_movable", message: string) {
    super(message);
  }
}

export type FreeCallBooking = { bookingId: string; startsAt: Date; endsAt: Date; title: string; label: string };

/**
 * La próxima llamada gratis de la persona del chat: su reserva de la IA o una
 * cita de su calendario que lo es (por el chat, el contacto o el número).
 */
const findUpcomingFreeCall = async (
  db: Db,
  input: { conversationId: string; contactId: string | null; phone: string | null; service: FreeCallService; now: Date }
): Promise<UpcomingFreeCall | null> => {
  const who: Prisma.CalendarAppointmentWhereInput[] = [{ conversationId: input.conversationId }];
  if (input.contactId) who.push({ contactId: input.contactId });
  // Las citas guardan el teléfono; un id de usuario (BSUID) no lo trae.
  if (input.phone && !isWhatsAppUserId(input.phone)) {
    const phones = [input.phone, whatsAppDigits(`+${input.phone}`)].flatMap(whatsAppIdVariants);
    if (phones.length) who.push({ phone: { in: [...new Set(phones)] } });
  }
  const bookings = await db.whatsAppBooking.findMany({
    where: { conversationId: input.conversationId, startsAt: { gte: input.now }, status: { notIn: CANCELLED_BOOKING } },
    orderBy: { startsAt: "asc" },
    select: BOOKING_ROW,
  });
  const appointments = await db.calendarAppointment.findMany({
    where: { OR: who, status: "active", startsAt: { gte: input.now } },
    orderBy: { startsAt: "asc" },
    take: 20,
    select: CALENDAR_ROW,
  });
  return pickUpcomingFreeCall({ bookings, appointments, service: input.service, now: input.now });
};

/**
 * La llamada gratis que esta persona ya tiene por delante, si la hay. Con ella
 * agendada, volver a pedirla («sí, a las 6:15», «perfecto») no es otra cita:
 * se le recuerda la que tiene. También la que Dayana le puso a mano en su
 * calendario (`source = calendar`; auditoría 21-oct: no se veía y se agendaba
 * otra), y nunca una sesión pagada (antes cualquier reserva «era» gratis).
 */
export const upcomingFreeCall = async (
  conversationId: string,
  config: WhatsAppAiConfig,
  now = new Date()
): Promise<UpcomingFreeCall | null> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { contactId: true, externalThreadId: true },
  });
  return findUpcomingFreeCall(prisma, {
    conversationId,
    contactId: conversation?.contactId ?? null,
    phone: conversation?.externalThreadId ?? null,
    service: freeCallService(config),
    now,
  });
};

export const bookFreeCall = async (input: {
  config: WhatsAppAiConfig;
  dayanaTz: string;
  personTz: string;
  start: Date;
  conversationId: string;
  contactId: string | null;
  phone: string;
  name: string | null;
}): Promise<FreeCallBooking> => {
  const service = freeCallService(input.config);
  const end = new Date(input.start.getTime() + service.minutes * 60_000);
  const active = { notIn: CANCELLED_BOOKING };

  // 1. Reservar en la base, con candado: las comprobaciones y la reserva van
  //    juntas, así dos personas no se quedan con la misma hora. Google no se
  //    llama aquí dentro (si tardara, la transacción se cortaría con el evento
  //    ya creado).
  const pending = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('whatsapp-free-call'))`;
      // Solo la llamada gratis: una sesión pagada ni la bloquea ni la tapa
      // (auditoría 21-oct: `findFirst` sin servicio y `isFreeCallService` con
      // 15 min daban «ya tiene» por cualquier reserva). La que Dayana puso a
      // mano también cuenta.
      const existing = await findUpcomingFreeCall(tx, {
        conversationId: input.conversationId,
        contactId: input.contactId,
        phone: input.phone,
        service,
        now: new Date(),
      });
      if (existing) throw new FreeCallError("already_booked", "Ya tiene agendada su llamada gratis.");
      // Con el respiro de Ajustes, como mira el calendario `bookOnCalendar`: el
      // evento se crea fuera del candado y dos reservas casi a la vez quedaban
      // pegadas, sin respiro (auditoría 21-oct).
      const busy = respiroRange(input.start, end, input.config.booking.bufferMin);
      const taken = await tx.whatsAppBooking.findFirst({
        where: { startsAt: { lt: busy.to }, endsAt: { gt: busy.from }, status: active },
        select: { id: true },
      });
      if (taken) throw new FreeCallError("unavailable", "Esa hora se acaba de ocupar.");
      const { from, to } = dayBounds(input.start, input.dayanaTz);
      const sameDay = (await freeCallsBetween(tx, service, from, to)).length;
      if (sameDay >= input.config.freeCall.maxPerDay) {
        throw new FreeCallError("daily_cap", "Ese día ya no hay cupos para la llamada gratis.");
      }
      return tx.whatsAppBooking.create({
        data: {
          conversationId: input.conversationId,
          contactId: input.contactId,
          phone: input.phone,
          name: input.name,
          service: service.name,
          startsAt: input.start,
          endsAt: end,
          googleAccountId: "pending",
          calendarEventId: `pending:${input.conversationId}:${input.start.toISOString()}`,
          status: "PENDING",
        },
        select: { id: true },
      });
    },
    { timeout: 15_000, maxWait: 15_000 }
  );

  // 2. El evento en el calendario (vuelve a mirar que la hora siga libre).
  //    Por WhatsApp: sin enlace de Meet. Si falla, se suelta la reserva.
  let created: Awaited<ReturnType<typeof bookOnCalendar>>;
  try {
    created = await (calendarDeps.book ?? bookOnCalendar)({
      config: { ...input.config.booking, addMeet: false },
      timezone: input.dayanaTz,
      start: input.start,
      durationMin: service.minutes,
      service: `${service.name} (Dayana llama por WhatsApp)`,
      name: input.name,
      phone: input.phone,
      conversationId: input.conversationId,
      contactId: input.contactId,
    });
  } catch (e) {
    await prisma.whatsAppBooking.delete({ where: { id: pending.id } }).catch(() => undefined);
    if (e instanceof SlotUnavailableError) throw new FreeCallError("unavailable", e.message);
    throw e;
  }

  // 3. La reserva pasa a cita, y queda en la agenda del CRM al instante (el
  //    reloj la volvería a leer en 10 min). Si esto fallara, el evento existe
  //    en el calendario y el reloj lo liga solo por el número del título.
  await prisma.whatsAppBooking.update({
    where: { id: pending.id },
    data: { googleAccountId: created.accountId, calendarEventId: created.eventId, eventUrl: created.eventUrl, endsAt: created.end, status: "BOOKED" },
  });
  await prisma.calendarAppointment
    .upsert({
      where: { eventId: created.eventId },
      create: {
        eventId: created.eventId,
        googleAccountId: created.accountId,
        startsAt: input.start,
        endsAt: created.end,
        title: created.title,
        name: input.name,
        phone: input.phone,
        sessionsLabel: "0/0",
        contactId: input.contactId,
        conversationId: input.conversationId,
        source: "ai",
        status: "active",
        matchState: "phone",
      },
      update: {},
    })
    .catch((e: unknown) => console.warn("[llamada gratis] la cita no quedó en la agenda del CRM (el reloj la leerá)", e));
  return {
    bookingId: pending.id,
    startsAt: input.start,
    endsAt: created.end,
    title: created.title,
    label: dualZoneLabel(input.start.toISOString(), input.personTz, input.dayanaTz),
  };
};

/** Después de agendar: el chat queda atendido y Dayana se entera (con sonido). */
export const afterFreeCallBooked = async (input: { conversationId: string; contactId: string | null; phone: string; booking: FreeCallBooking }) => {
  await resolveConversations(
    { ids: [input.conversationId], phones: [input.phone], contactIds: [input.contactId] },
    "appointment",
    null,
    { seenInboundAt: new Date() }
  ).catch((e: unknown) => console.warn("[llamada gratis] no se pudo marcar el chat como atendido", e));
  fireNotification({
    eventType: "WHATSAPP_AI_BOOKED",
    title: `Llamada gratis agendada: ${input.booking.title}`,
    body: `${input.booking.label} · la asistente la agendó sola. La llamas por WhatsApp.`,
    href: `/admin/whatsapp?conversation=${input.conversationId}`,
    entityType: "Conversation",
    entityId: input.conversationId,
    staff: "ALL",
  });
};

/**
 * Mueve la llamada gratis que ya tiene a otra hora que se le ofreció
 * (Alexandra, 21-oct: pidió el viernes y `book_free_call` le dejaba el jueves
 * con «ya tiene agendada»; la IA le confirmó el viernes sin cita). El mismo
 * evento cambia de hora: no quedan dos en el calendario de Dayana. Con el
 * candado y las mismas reglas que al agendar (hora libre, tope del día), sin
 * contarse a sí misma.
 */
export const moveFreeCall = async (input: {
  config: WhatsAppAiConfig;
  dayanaTz: string;
  personTz: string;
  bookingId: string;
  start: Date;
}): Promise<FreeCallBooking & { from: Date }> => {
  const service = freeCallService(input.config);
  const end = new Date(input.start.getTime() + service.minutes * 60_000);
  const active = { notIn: CANCELLED_BOOKING };
  const current = await prisma.whatsAppBooking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, startsAt: true, endsAt: true, calendarEventId: true, name: true },
  });
  // `upcomingFreeCall` también da la llamada que Dayana puso a mano en su
  // calendario (sin reserva de este chat): esa no la mueve la IA, como no le
  // cambia el título sin permiso (`TITLE_PATCH_KEY`). La cambia ella.
  if (!current) {
    throw new FreeCallError(
      "not_movable",
      "Esa llamada la puso Dayana en su calendario: no la puedo mover. Dile que le pasas su pedido a Dayana y escala con category=reschedule."
    );
  }
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('whatsapp-free-call'))`;
      // Con el respiro, como al agendar.
      const busy = respiroRange(input.start, end, input.config.booking.bufferMin);
      const taken = await tx.whatsAppBooking.findFirst({
        where: { id: { not: current.id }, startsAt: { lt: busy.to }, endsAt: { gt: busy.from }, status: active },
        select: { id: true },
      });
      if (taken) throw new FreeCallError("unavailable", "Esa hora se acaba de ocupar.");
      const { from, to } = dayBounds(input.start, input.dayanaTz);
      const sameDay = (await freeCallsBetween(tx, service, from, to, { bookingId: current.id, eventId: current.calendarEventId })).length;
      if (sameDay >= input.config.freeCall.maxPerDay) {
        throw new FreeCallError("daily_cap", "Ese día ya no hay cupos para la llamada gratis.");
      }
      // La hora nueva queda reservada dentro del candado (como en `bookFreeCall`):
      // nadie más la toma mientras se mueve el evento.
      await tx.whatsAppBooking.update({ where: { id: current.id }, data: { startsAt: input.start, endsAt: end } });
    },
    { timeout: 15_000, maxWait: 15_000 }
  );
  let moved: { end: Date };
  try {
    moved = await (calendarDeps.move ?? moveOnCalendar)({
      config: { ...input.config.booking, addMeet: false },
      timezone: input.dayanaTz,
      eventId: current.calendarEventId,
      start: input.start,
      durationMin: service.minutes,
    });
  } catch (e) {
    // El calendario no la movió: la reserva vuelve a su hora.
    await prisma.whatsAppBooking
      .update({ where: { id: current.id }, data: { startsAt: current.startsAt, endsAt: current.endsAt } })
      .catch((err: unknown) => console.warn("[llamada gratis] no se pudo devolver la reserva a su hora", err));
    if (e instanceof SlotUnavailableError) throw new FreeCallError("unavailable", e.message);
    throw e;
  }
  if (moved.end.getTime() !== end.getTime()) {
    await prisma.whatsAppBooking.update({ where: { id: current.id }, data: { endsAt: moved.end } });
  }
  // La cita del CRM a la hora nueva, con los recordatorios y el resultado de la llamada en cero.
  const appt = await prisma.calendarAppointment
    .update({
      where: { eventId: current.calendarEventId },
      data: {
        startsAt: input.start,
        endsAt: moved.end,
        reminderSentAt: null,
        reminderError: null,
        confirmedAt: null,
        reminderSoonSentAt: null,
        reminderSoonError: null,
        reminderSoonSkipped: null,
        waitNoticeCount: 0,
        waitNoticeAt: null,
        callOutcome: null,
        callOutcomeSource: null,
        callOutcomeReason: null,
        callOutcomeAt: null,
        outcomeCheckAt: null,
        clashEventId: null,
        clashWith: Prisma.DbNull,
        clashNotifiedAt: null,
      },
      select: { title: true },
    })
    .catch((e: unknown) => {
      console.warn("[llamada gratis] la cita movida no se actualizó en el CRM (el reloj la leerá)", e);
      return null;
    });
  return {
    bookingId: current.id,
    startsAt: input.start,
    endsAt: moved.end,
    title: appt?.title ?? current.name ?? "Llamada gratis",
    label: dualZoneLabel(input.start.toISOString(), input.personTz, input.dayanaTz),
    from: current.startsAt,
  };
};

/** Movida: Dayana se entera (con sonido), con la hora de antes y la nueva. */
export const afterFreeCallMoved = (input: { conversationId: string; booking: FreeCallBooking & { from: Date }; dayanaTz: string }) => {
  const before = dualZoneLabel(input.booking.from.toISOString(), input.dayanaTz, input.dayanaTz);
  fireNotification({
    eventType: "WHATSAPP_AI_BOOKED",
    title: `Llamada gratis movida: ${input.booking.title}`,
    body: `De ${before} a ${dualZoneLabel(input.booking.startsAt.toISOString(), input.dayanaTz, input.dayanaTz)}. La persona lo pidió; ya está en tu calendario.`,
    href: `/admin/whatsapp?conversation=${input.conversationId}`,
    entityType: "Conversation",
    entityId: input.conversationId,
    staff: "ALL",
  });
};
