import { randomUUID } from "node:crypto";

import { resolveGoogleAccount } from "@/lib/crm-tools/google";
import { prisma } from "@/lib/db";
import { deleteEvent } from "@/lib/google/calendar";
import type { WhatsAppBookingConfig } from "../whatsapp-ai-config";
import { availableSlots, bookOnCalendar, moveOnCalendar, SlotUnavailableError } from "../whatsapp-agent/calendar";
import { buildEventTitle } from "../whatsapp-agent/event-title";
import type { CalendarDeps } from "../whatsapp-agent/free-call";
import { CANCELLED_BOOKING } from "../whatsapp-agent/free-call-rules";
import { findFreeSlots, isWithinBookingHours, overlapsBusy, type Busy } from "../whatsapp-agent/slots";

/**
 * El calendario que usa la página de la llamada gratis.
 *
 * En producción, el de Dayana en Google (el mismo que usa la asistente de
 * WhatsApp). Fuera de producción —el computador de quien desarrolla, una
 * vista previa— uno de mentira: las pruebas nunca deben crear, mover ni borrar
 * eventos en el calendario real de Dayana. El de mentira calcula las horas con
 * su horario de Ajustes y lo que ya está agendado en la base, y «crea» eventos
 * con un id `local-…` que no existe en Google.
 *
 * `CALL_FUNNEL_REAL_CALENDAR=1` fuerza el de Google fuera de producción (para
 * probar la conexión a propósito).
 */

const DAY = 24 * 60 * 60_000;

export const usesRealCalendar = (): boolean =>
  process.env.VERCEL_ENV === "production" || process.env.CALL_FUNNEL_REAL_CALENDAR === "1";

export const LOCAL_EVENT_PREFIX = "local-";

/**
 * Lo ocupado según la base: las reservas vivas y las citas del calendario ya
 * leídas. `forBooking`: al crear o mover el evento, las reservas «PENDING» no
 * cuentan — son la propia reserva que `bookFreeCall` aparta bajo su candado
 * antes de llamar al calendario (el de Google tampoco la ve).
 */
const busyFromDb = async (from: Date, to: Date, opts: { ignoreEventId?: string; forBooking?: boolean } = {}): Promise<Busy[]> => {
  const { ignoreEventId } = opts;
  const [bookings, appointments] = await Promise.all([
    prisma.whatsAppBooking.findMany({
      where: {
        startsAt: { lt: to },
        endsAt: { gt: from },
        status: { notIn: opts.forBooking ? [...CANCELLED_BOOKING, "PENDING"] : CANCELLED_BOOKING },
      },
      select: { startsAt: true, endsAt: true, calendarEventId: true },
    }),
    prisma.calendarAppointment.findMany({
      where: { startsAt: { lt: to }, endsAt: { gt: from }, status: "active" },
      select: { startsAt: true, endsAt: true, eventId: true },
    }),
  ]);
  const seen = new Set<string>();
  const out: Busy[] = [];
  for (const row of [
    ...bookings.map((b) => ({ id: b.calendarEventId, startsAt: b.startsAt, endsAt: b.endsAt })),
    ...appointments.map((a) => ({ id: a.eventId, startsAt: a.startsAt, endsAt: a.endsAt })),
  ]) {
    if (row.id === ignoreEventId || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ start: row.startsAt.getTime(), end: row.endsAt.getTime() });
  }
  return out;
};

const checkLocal = async (input: {
  config: WhatsAppBookingConfig;
  timezone: string;
  start: Date;
  durationMin: number;
  ignoreEventId?: string;
}): Promise<Date> => {
  const end = new Date(input.start.getTime() + input.durationMin * 60_000);
  if (input.start.getTime() < Date.now() + input.config.minNoticeHours * 3600_000 - 60_000) {
    throw new SlotUnavailableError("Esa hora está demasiado cerca.");
  }
  if (!isWithinBookingHours(input.config, input.start, input.durationMin, input.timezone)) {
    throw new SlotUnavailableError("Esa hora está fuera del horario en que Dayana atiende.");
  }
  const busy = await busyFromDb(new Date(input.start.getTime() - DAY), new Date(end.getTime() + DAY), {
    ignoreEventId: input.ignoreEventId,
    forBooking: true,
  });
  if (overlapsBusy(input.start.getTime(), end.getTime(), busy, input.config.bufferMin)) {
    throw new SlotUnavailableError("Esa hora ya se ocupó.");
  }
  return end;
};

const localCalendar: Required<CalendarDeps> = {
  available: async (input) => {
    const now = input.now ?? new Date();
    const until = new Date(now.getTime() + input.config.horizonDays * DAY);
    return findFreeSlots({
      config: input.config,
      durationMin: input.durationMin,
      busy: await busyFromDb(now, until),
      windows: [],
      timezone: input.timezone,
      now,
      from: input.from,
      to: input.to,
      limit: input.limit,
    });
  },
  book: async (input) => {
    const end = await checkLocal(input);
    return {
      accountId: "local",
      eventId: `${LOCAL_EVENT_PREFIX}${randomUUID()}`,
      meetUrl: null,
      eventUrl: null,
      title: buildEventTitle({ name: input.name, phone: input.phone, freeCall: true }),
      end,
    };
  },
  move: async (input) => ({ end: await checkLocal({ ...input, ignoreEventId: input.eventId }) }),
};

const googleCalendar: Required<CalendarDeps> = { available: availableSlots, book: bookOnCalendar, move: moveOnCalendar };

/** El calendario de esta petición. */
export const funnelCalendar = (): Required<CalendarDeps> => (usesRealCalendar() ? googleCalendar : localCalendar);

/** Borra el evento de la cita cancelada (uno de mentira no existe en Google). */
export const removeCalendarEvent = async (config: WhatsAppBookingConfig, eventId: string): Promise<void> => {
  if (!usesRealCalendar() || eventId.startsWith(LOCAL_EVENT_PREFIX) || eventId.startsWith("pending:")) return;
  const { token } = await resolveGoogleAccount("CALENDAR", config.accountId || undefined);
  await deleteEvent(token, eventId);
};
