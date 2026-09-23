import { randomBytes, randomUUID } from "node:crypto";

import { AppointmentStatus, ContactSource, GoogleService } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  getDateKeyInTz,
  getTimeHmInTz,
  zonedDateTimeToUtc,
} from "@/lib/datetime/zoned-time";
import { getOperationalTimezone } from "./operational-timezone";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import { listActiveGoogleAccountsForService } from "./google-accounts";
import { getAccountToken } from "@/lib/google/connect";
import { createEvent, deleteEvent, freeBusy } from "@/lib/google/calendar";

/**
 * Agenda pública: `/agenda`.
 *
 * La disponibilidad NO se guarda aquí. Se calcula en cada carga cruzando tres
 * cosas: el horario que Dayana define en el CRM, lo que su Google Calendar
 * dice que está ocupado, y las citas ya reservadas. Guardar «huecos libres»
 * en una tabla sería garantizar que un día alguien reserve encima de algo que
 * Dayana apuntó en su calendario desde el teléfono.
 */

const CONFIG_KEY = "booking.config";

const ruleSchema = z.object({
  /** 0 = domingo, 6 = sábado (igual que `Date.getDay`). */
  weekday: z.number().int().min(0).max(6),
  /** "09:00" en la zona operativa. */
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});

export const bookingConfigSchema = z.object({
  /** Apagada, `/agenda` responde 404 en vez de ofrecer horas que nadie atiende. */
  isActive: z.boolean(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).nullable(),
  /** Minutos que dura la cita. */
  durationMinutes: z.number().int().min(10).max(240),
  /** Minutos de respiro después de cada cita. */
  bufferMinutes: z.number().int().min(0).max(120),
  /** Con cuánta antelación mínima se puede reservar (horas). */
  minNoticeHours: z.number().int().min(0).max(168),
  /** Cuántos días hacia adelante se muestran. */
  horizonDays: z.number().int().min(1).max(60),
  rules: z.array(ruleSchema).max(21),
});

export type BookingConfig = z.infer<typeof bookingConfigSchema>;

/**
 * Lo que hay antes de que nadie configure nada: llamada corta, entre semana,
 * de 9 a 18. Dayana lo cambia en el CRM; esto solo evita que la primera carga
 * sea una pantalla vacía.
 */
export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  isActive: false,
  title: "Llamada gratis de 15 minutos",
  description:
    "Nos conocemos, me cuentas qué te está pasando y te digo con honestidad si puedo ayudarte.",
  durationMinutes: 15,
  bufferMinutes: 15,
  minNoticeHours: 4,
  horizonDays: 14,
  rules: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    from: "09:00",
    to: "18:00",
  })),
};

export const getBookingConfig = async (): Promise<BookingConfig> => {
  const raw = await getSiteSetting(CONFIG_KEY);
  if (!raw) return DEFAULT_BOOKING_CONFIG;
  try {
    const parsed = bookingConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_BOOKING_CONFIG;
  } catch {
    return DEFAULT_BOOKING_CONFIG;
  }
};

export const setBookingConfig = (config: BookingConfig): Promise<void> =>
  setSiteSetting(CONFIG_KEY, JSON.stringify(config));

const MINUTE = 60_000;

const hmToMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

const minutesToHm = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

export type DaySlots = {
  /** "2026-09-25" en la zona operativa. */
  dateKey: string;
  slots: { startIso: string; label: string }[];
};

type Busy = { start: number; end: number };

/**
 * Huecos libres de aquí a `horizonDays`.
 *
 * Un hueco necesita caber entero —cita más respiro— dentro de una franja del
 * horario, y no solaparse con nada ocupado. El respiro cuenta también hacia
 * atrás: una cita que termina a las 10:00 no deja libre las 10:00.
 */
export const listAvailableSlots = async (
  config: BookingConfig,
  timezone: string,
  now = new Date()
): Promise<DaySlots[]> => {
  if (!config.isActive || config.rules.length === 0) return [];

  const from = new Date(now.getTime() + config.minNoticeHours * 60 * MINUTE);
  const until = new Date(now.getTime() + config.horizonDays * 24 * 60 * MINUTE);

  const busy: Busy[] = [];

  // Lo que ya está reservado aquí cuenta aunque el calendario falle.
  const appointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.BOOKED,
      startsAt: { lt: until },
      endsAt: { gt: now },
    },
    select: { startsAt: true, endsAt: true },
  });
  for (const a of appointments) {
    busy.push({ start: a.startsAt.getTime(), end: a.endsAt.getTime() });
  }

  // Y lo que diga el calendario de Dayana. Si Google falla, se sigue con lo
  // de arriba: mejor ofrecer de más y que ella mueva una cita, que enseñar
  // una agenda vacía y perder a quien vino a reservar.
  const account = (await listActiveGoogleAccountsForService(GoogleService.CALENDAR))[0];
  if (account) {
    try {
      const token = await getAccountToken(account.id);
      const periods = await freeBusy(token, {
        timeMin: now.toISOString(),
        timeMax: until.toISOString(),
        timeZone: timezone,
      });
      for (const p of periods) {
        busy.push({
          start: new Date(p.start).getTime(),
          end: new Date(p.end).getTime(),
        });
      }
    } catch (e) {
      console.error("[booking] no se pudo leer el calendario", e);
    }
  }

  const rulesByWeekday = new Map<number, { from: number; to: number }[]>();
  for (const rule of config.rules) {
    const list = rulesByWeekday.get(rule.weekday) ?? [];
    list.push({ from: hmToMinutes(rule.from), to: hmToMinutes(rule.to) });
    rulesByWeekday.set(rule.weekday, list);
  }

  const step = config.durationMinutes + config.bufferMinutes;
  const days: DaySlots[] = [];

  for (let i = 0; i < config.horizonDays; i++) {
    const dayAnchor = new Date(now.getTime() + i * 24 * 60 * MINUTE);
    const dateKey = getDateKeyInTz(dayAnchor, timezone);
    // El día de la semana, visto desde la zona operativa.
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    const ranges = rulesByWeekday.get(weekday);
    if (!ranges?.length) continue;

    const slots: DaySlots["slots"] = [];

    for (const range of ranges) {
      for (let m = range.from; m + config.durationMinutes <= range.to; m += step) {
        let start: Date;
        try {
          start = zonedDateTimeToUtc(dateKey, minutesToHm(m), timezone);
        } catch {
          continue;
        }
        const startMs = start.getTime();
        const endMs = startMs + config.durationMinutes * MINUTE;
        if (startMs < from.getTime() || endMs > until.getTime()) continue;

        // El respiro se aplica a los dos lados: pegado a algo ocupado no vale.
        const guard = config.bufferMinutes * MINUTE;
        const overlaps = busy.some(
          (b) => startMs - guard < b.end && endMs + guard > b.start
        );
        if (overlaps) continue;

        slots.push({
          startIso: start.toISOString(),
          label: getTimeHmInTz(start, timezone),
        });
      }
    }

    if (slots.length > 0) days.push({ dateKey, slots });
  }

  return days;
};

export class BookingError extends Error {
  constructor(readonly code: "slot_taken" | "invalid_slot" | "closed") {
    super(code);
  }
}

const MAGNET_PLACEHOLDER_PHONE_PREFIX = "+nophone";

/**
 * Reserva una cita.
 *
 * El hueco se vuelve a comprobar aquí, contra la misma función que pinta la
 * página: entre que alguien ve la pantalla y pulsa «reservar» pueden pasar
 * minutos, y dos personas mirando la misma hora es el caso normal, no el raro.
 */
export const createBooking = async (input: {
  startIso: string;
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
  source?: string | null;
}): Promise<{
  id: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  meetUrl: string | null;
  cancelToken: string;
}> => {
  const config = await getBookingConfig();
  if (!config.isActive) throw new BookingError("closed");

  const timezone = await getOperationalTimezone();
  const startsAt = new Date(input.startIso);
  if (Number.isNaN(startsAt.getTime())) throw new BookingError("invalid_slot");

  const available = await listAvailableSlots(config, timezone);
  const isOffered = available.some((day) =>
    day.slots.some((s) => s.startIso === startsAt.toISOString())
  );
  if (!isOffered) throw new BookingError("slot_taken");

  const endsAt = new Date(startsAt.getTime() + config.durationMinutes * MINUTE);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  const contactId = await resolveBookingContact({
    email,
    name,
    phone: input.phone?.trim() || null,
    source: input.source ?? null,
  });

  const cancelToken = randomBytes(16).toString("hex");

  const appointment = await prisma.appointment.create({
    data: {
      contactId,
      startsAt,
      endsAt,
      timezone,
      name,
      email,
      phone: input.phone?.trim() || null,
      note: input.note?.trim() || null,
      cancelToken,
    },
    select: { id: true },
  });

  // El evento del calendario va después de guardar: si Google falla, la cita
  // existe igual y se ve en el panel. Al revés se perdería la reserva.
  let meetUrl: string | null = null;
  const account = (await listActiveGoogleAccountsForService(GoogleService.CALENDAR))[0];
  if (account) {
    try {
      const token = await getAccountToken(account.id);
      const event = await createEvent(token, {
        summary: `${config.title} — ${name}`,
        description: [
          input.note?.trim() ? `Escribió: ${input.note.trim()}` : null,
          `Correo: ${email}`,
          input.phone?.trim() ? `WhatsApp: ${input.phone.trim()}` : null,
          "Reservado desde dayanabeltran.com/agenda",
        ]
          .filter(Boolean)
          .join("\n"),
        startIso: startsAt.toISOString(),
        endIso: endsAt.toISOString(),
        timeZone: timezone,
        attendeeEmails: [email],
        withMeet: true,
      });
      meetUrl = event.hangoutLink ?? null;
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          googleEventId: event.id,
          googleAccountId: account.id,
          meetUrl,
        },
      });
    } catch (e) {
      console.error("[booking] no se pudo crear el evento en el calendario", e);
    }
  }

  return {
    id: appointment.id,
    startsAt,
    endsAt,
    timezone,
    meetUrl,
    cancelToken,
  };
};

/** Ficha del CRM de quien reserva. Con teléfono se empareja por teléfono. */
const resolveBookingContact = async (input: {
  email: string;
  name: string;
  phone: string | null;
  source: string | null;
}): Promise<string> => {
  if (input.phone) {
    const { upsertContactByPhone } = await import("./contacts");
    const { contact } = await upsertContactByPhone({
      phone: input.phone,
      firstName: input.name,
      email: input.email,
      source: sourceFor(input.source),
      sourceDetail: "agenda",
    });
    return contact.id;
  }

  const existing = await prisma.contact.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.contact.create({
    data: {
      phoneE164: `${MAGNET_PLACEHOLDER_PHONE_PREFIX}:${randomUUID()}`,
      firstName: input.name,
      email: input.email,
      source: sourceFor(input.source),
      sourceDetail: "agenda",
    },
    select: { id: true },
  });
  return created.id;
};

const sourceFor = (source: string | null): ContactSource => {
  switch (source) {
    case "tiktok":
      return ContactSource.TIKTOK;
    case "instagram":
      return ContactSource.INSTAGRAM;
    case "whatsapp":
      return ContactSource.WHATSAPP_DIRECT;
    default:
      return ContactSource.WEB;
  }
};

export const getAppointmentByCancelToken = (token: string) =>
  prisma.appointment.findUnique({
    where: { cancelToken: token },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      name: true,
      status: true,
      meetUrl: true,
    },
  });

/**
 * Cancela y libera el hueco. Idempotente: cancelar dos veces no es un error,
 * porque el enlace del correo se puede pulsar dos veces.
 */
export const cancelAppointment = async (
  id: string,
  cancelledBy: "persona" | "equipo"
): Promise<void> => {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      status: true,
      googleEventId: true,
      googleAccountId: true,
    },
  });
  if (!appointment || appointment.status === AppointmentStatus.CANCELLED) return;

  await prisma.appointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy,
    },
  });

  if (appointment.googleEventId && appointment.googleAccountId) {
    try {
      const token = await getAccountToken(appointment.googleAccountId);
      await deleteEvent(token, appointment.googleEventId);
    } catch (e) {
      // El hueco ya está libre en el CRM; el evento huérfano lo ve Dayana.
      console.error("[booking] no se pudo borrar el evento del calendario", e);
    }
  }
};

export const listAppointments = (take = 50) =>
  prisma.appointment.findMany({
    orderBy: { startsAt: "asc" },
    where: { startsAt: { gte: new Date(Date.now() - 24 * 60 * MINUTE) } },
    take,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      name: true,
      email: true,
      phone: true,
      note: true,
      meetUrl: true,
      status: true,
      contactId: true,
      createdAt: true,
    },
  });
