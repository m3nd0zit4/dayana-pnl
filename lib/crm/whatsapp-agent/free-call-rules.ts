import { getDateKeyInTz } from "@/lib/datetime/zoned-time";

import { isFreeCallAppointment, isFreeCallService } from "./event-title";

/**
 * La llamada gratis en la base y en el calendario de Dayana, en reglas puras
 * (auditoría del 21-oct-2026 sobre `main`):
 *
 * - Qué reserva de la IA es la llamada gratis (`isFreeCallBooking`): antes se
 *   miraba con los minutos de la llamada gratis (15) y no con los de la reserva,
 *   así que todo «era» gratis: una sesión pagada bloqueaba la llamada y la IA
 *   podía mover la sesión como si fuera la llamada.
 * - Qué cita del calendario es una llamada gratis que Dayana puso a mano
 *   (`isCalendarFreeCall`): no se veía como «ya tiene llamada», se agendaba
 *   otra y no contaba en el tope del día. Con cuidado: una sesión pagada nunca.
 * - El respiro entre citas también en la base (`respiroRange`): dos reservas
 *   casi a la vez quedaban pegadas, porque el calendario se mira fuera del candado.
 * - La reserva sigue al calendario (`bookingFollowsEvent`, `listedUntil`): si
 *   Dayana movía o borraba el evento en Google, la reserva seguía con la hora
 *   vieja (la IA le recordaba esa hora y contaba en el tope).
 */

/** Estados de una reserva cancelada (se escribió de las dos formas). */
export const CANCELLED_BOOKING = ["CANCELLED", "cancelled"];

const isActive = (status: string | null | undefined) => !CANCELLED_BOOKING.includes(status ?? "");

const minutesOf = (a: { startsAt: Date; endsAt: Date }) => (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000;

const fmt = (iso: string, tz: string, withDay: boolean) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    ...(withDay ? { weekday: "long", day: "numeric", month: "long" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * «jueves 16 de octubre, 3:00 p. m. (tu hora) · 4:00 p. m. en Colombia».
 * Si la persona está en la hora de Colombia, una sola.
 */
export const dualZoneLabel = (iso: string, personTz: string, dayanaTz: string): string => {
  const mine = fmt(iso, personTz, true);
  const sameClock = fmt(iso, personTz, true) === fmt(iso, dayanaTz, true);
  return sameClock ? mine : `${mine} (tu hora) · ${fmt(iso, dayanaTz, false)} en Colombia`;
};

/**
 * Una hora para un mensaje que sale solo (reagendar). Con su zona, las dos
 * horas; sin saberla, la de Colombia dicha como tal: nunca la de Colombia como
 * si fuera la suya (Valerya, México, 17-oct).
 */
export const slotLabel = (iso: string, personTz: string | null, dayanaTz: string): string =>
  personTz ? dualZoneLabel(iso, personTz, dayanaTz) : `${fmt(iso, dayanaTz, true)} (hora de Colombia)`;

export type BookingRow = {
  id: string;
  service: string;
  startsAt: Date;
  endsAt: Date;
  meetUrl?: string | null;
  status: string;
  calendarEventId: string;
};

/**
 * ¿Esta reserva de la IA es la llamada gratis? Por el servicio de Ajustes o,
 * si se llamaba distinto, por su propio servicio y SU duración, sin Meet. Antes
 * `isFreeCallService(servicio, 15)` daba sí a cualquier reserva.
 */
export const isFreeCallBooking = (
  b: { service: string; startsAt: Date; endsAt: Date; meetUrl?: string | null },
  service: { name: string }
): boolean =>
  b.service.trim().toLowerCase() === service.name.trim().toLowerCase() || (!b.meetUrl && isFreeCallService(b.service, minutesOf(b)));

export type CalendarRow = {
  id: string;
  eventId: string;
  title: string;
  sessionsLabel: string | null;
  meetUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  phone: string | null;
  contactId: string | null;
  conversationId: string | null;
};

/** Así se nombran las sesiones pagadas que Dayana escribe a mano («3.6 jesus terapia…»). */
const PAID_WORDS = /\b(terapia|sesi[oó]n(es)?)\b/i;

/**
 * ¿Una cita del calendario es una llamada gratis? Con cuidado, porque una
 * sesión pagada nunca debe parecerlo: sin Meet, sin contador de sesiones (o
 * `0/0`), de 20 minutos o menos (`isFreeCallAppointment`), sin «terapia» ni
 * «sesión» en el título, y de alguien (`0/0`, que es como Dayana escribe la
 * llamada gratis, o ligada a una persona): «Llamar al banco» de 15 min no lo es.
 */
export const isCalendarFreeCall = (a: Omit<CalendarRow, "id" | "eventId">): boolean => {
  if (a.meetUrl || PAID_WORDS.test(a.title)) return false;
  if (!isFreeCallAppointment(a)) return false;
  return a.sessionsLabel?.trim() === "0/0" || Boolean(a.phone || a.contactId || a.conversationId);
};

export type UpcomingFreeCall = {
  /** La reserva (`source = booking`) o la cita del calendario (`source = calendar`). */
  id: string;
  startsAt: Date;
  calendarEventId: string;
  /**
   * `booking`: la agendó la IA en este chat (se puede mover). `calendar`: está
   * en el calendario de Dayana sin reserva de este chat (la puso ella, o se
   * agendó desde otro chat de la misma persona): la cambia Dayana.
   */
  source: "booking" | "calendar";
};

/**
 * La próxima llamada gratis de la persona: una reserva suya de la IA o una cita
 * de su calendario que es una llamada gratis. La cita de una reserva es la
 * misma llamada (mismo evento): cuenta la reserva.
 */
export const pickUpcomingFreeCall = (input: {
  bookings: BookingRow[];
  appointments: CalendarRow[];
  service: { name: string };
  now: Date;
}): UpcomingFreeCall | null => {
  const now = input.now.getTime();
  const active = input.bookings.filter((b) => isActive(b.status));
  const own = active.filter((b) => b.startsAt.getTime() >= now && isFreeCallBooking(b, input.service));
  // El evento de una reserva en pie lo decide la reserva (gratis o pagada).
  const ownEvents = new Set(active.map((b) => b.calendarEventId));
  const options: UpcomingFreeCall[] = [
    ...own.map((b) => ({ id: b.id, startsAt: b.startsAt, calendarEventId: b.calendarEventId, source: "booking" as const })),
    ...input.appointments
      .filter((a) => !ownEvents.has(a.eventId) && a.startsAt.getTime() >= now && isCalendarFreeCall(a))
      .map((a) => ({ id: a.id, startsAt: a.startsAt, calendarEventId: a.eventId, source: "calendar" as const })),
  ];
  return options.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
};

/**
 * Las llamadas gratis de un rango para el tope del día, una por evento del
 * calendario: las reservas activas de la IA (también la que se está agendando,
 * aún sin evento) y las citas que son llamadas gratis puestas a mano.
 */
export const countedFreeCalls = (input: {
  bookings: BookingRow[];
  appointments: CalendarRow[];
  service: { name: string };
}): { eventId: string; startsAt: Date }[] => {
  const out = new Map<string, Date>();
  const active = input.bookings.filter((b) => isActive(b.status));
  for (const b of active) if (isFreeCallBooking(b, input.service)) out.set(b.calendarEventId, b.startsAt);
  // El evento de una reserva en pie lo decide la reserva (gratis o pagada).
  const booked = new Set(active.map((b) => b.calendarEventId));
  for (const a of input.appointments) if (!booked.has(a.eventId) && isCalendarFreeCall(a)) out.set(a.eventId, a.startsAt);
  return [...out].map(([eventId, startsAt]) => ({ eventId, startsAt }));
};

/** Cuántas llamadas gratis hay cada día (en la zona de Dayana). */
export const freeCallsPerDay = (calls: { startsAt: Date }[], tz: string): Map<string, number> => {
  const perDay = new Map<string, number>();
  for (const c of calls) {
    const key = getDateKeyInTz(c.startsAt, tz);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  return perDay;
};

/**
 * El rango que tiene que estar libre de otras reservas para agendar
 * [start, end): con el respiro de Ajustes a cada lado, como `overlapsBusy`
 * mira el calendario. Una reserva choca si empieza antes de `to` y termina
 * después de `from`.
 */
export const respiroRange = (start: Date, end: Date, bufferMin: number): { from: Date; to: Date } => ({
  from: new Date(start.getTime() - bufferMin * 60_000),
  to: new Date(end.getTime() + bufferMin * 60_000),
});

export type BookingSync = { kind: "keep" } | { kind: "update"; data: { startsAt: Date; endsAt: Date; status?: "BOOKED" } };

/**
 * La reserva de la IA sigue a su evento del calendario. Se mueve solo si el
 * evento cambió desde la última vez que el CRM lo vio (`seenBefore`, la cita
 * guardada) o si es la primera vez: mientras la IA mueve la llamada, la reserva
 * ya tiene la hora nueva y Google todavía la vieja, y eso no se devuelve. Si
 * la reserva estaba cancelada y el evento está (Dayana lo restauró), vuelve.
 */
export const bookingFollowsEvent = (input: {
  booking: { startsAt: Date; endsAt: Date; status: string };
  event: { start: Date; end: Date };
  seenBefore: { startsAt: Date; endsAt: Date } | null;
}): BookingSync => {
  const { booking, event, seenBefore } = input;
  const times = { startsAt: event.start, endsAt: event.end };
  if (!isActive(booking.status)) return { kind: "update", data: { ...times, status: "BOOKED" } };
  const same = (a: { startsAt: Date; endsAt: Date }) =>
    a.startsAt.getTime() === event.start.getTime() && a.endsAt.getTime() === event.end.getTime();
  const eventMoved = !seenBefore || !same(seenBefore);
  return eventMoved && !same(booking) ? { kind: "update", data: times } : { kind: "keep" };
};

/**
 * Hasta dónde la lectura del calendario permite decir que una cita «ya no
 * está». Google devuelve como mucho `maxResults` eventos, por hora: si llegó
 * al máximo, lo que empieza después del último leído no se vio, no se borró
 * (cancelarlo soltaría la reserva y se podría agendar otra llamada encima).
 */
export const listedUntil = (input: {
  events: { start?: { dateTime?: string; date?: string } }[];
  maxResults: number;
  windowEnd: Date;
}): Date => {
  if (input.events.length < input.maxResults) return input.windowEnd;
  const starts = input.events
    .map((e) => new Date(e.start?.dateTime ?? e.start?.date ?? NaN).getTime())
    .filter((t) => !Number.isNaN(t));
  if (starts.length === 0) return input.windowEnd;
  return new Date(Math.min(Math.max(...starts) - 1, input.windowEnd.getTime()));
};
