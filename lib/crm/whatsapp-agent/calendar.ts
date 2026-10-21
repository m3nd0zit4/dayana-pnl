import { resolveGoogleAccount } from "@/agent/lib/google";
import { createEvent, listEvents, patchEventTime } from "@/lib/google/calendar";
import { getSiteUrl } from "@/lib/site-url";
import { zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import { prisma } from "@/lib/db";
import type { WhatsAppBookingConfig } from "../whatsapp-ai-config";
import { buildEventTitle, isFreeCallService } from "./event-title";
import {
  findFreeSlots,
  isWithinBookingHours,
  overlapsBusy,
  type Busy,
  type Slot,
} from "./slots";

/**
 * El calendario de Dayana, visto por la IA de WhatsApp.
 *
 * Lo ocupado se lee con `events.list` y no con `freeBusy`: la cuenta está
 * conectada con el alcance `calendar.events`, que alcanza para leer y crear
 * eventos, y así no hay que pedirle a Dayana que vuelva a autorizar Google.
 * Un evento marcado «Disponible» (transparente) o cancelado no ocupa.
 */

const DAY = 24 * 60 * 60_000;

const account = (config: WhatsAppBookingConfig) =>
  resolveGoogleAccount("CALENDAR", config.accountId || undefined);

const toMs = (
  value: { dateTime?: string; date?: string } | undefined,
  timezone: string
): number | null => {
  if (value?.dateTime) return new Date(value.dateTime).getTime();
  // Todo el día: la fecha sola, medianoche en la zona operativa.
  if (value?.date) return zonedDateTimeToUtc(value.date, "00:00", timezone).getTime();
  return null;
};

/**
 * Un evento que Dayana crea en su calendario para marcar cuándo atiende:
 * «Disponible», «Citas», «Agenda» o «Disponible para citas». No ocupa: marca
 * el rato en que la IA puede ofrecer horas.
 */
export const isAvailabilityBlock = (summary?: string | null): boolean =>
  /^\s*(disponible|citas?|agenda)(\s+(para\s+)?(citas?|sesiones|agendar))?\s*$/i.test(summary ?? "");

export type CalendarView = { busy: Busy[]; windows: Busy[] };

/** Lo ocupado y los bloques «Disponible» del calendario, entre dos instantes. */
export const readCalendar = async (
  config: WhatsAppBookingConfig,
  from: Date,
  to: Date,
  timezone: string,
  /** Un evento que no cuenta como ocupado (la llamada que se está moviendo). */
  ignoreEventId?: string
): Promise<CalendarView> => {
  const { token } = await account(config);
  const events = await listEvents(token, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    maxResults: 250,
  });
  const busy: Busy[] = [];
  const windows: Busy[] = [];
  for (const event of events) {
    if (event.status === "cancelled" || (ignoreEventId && event.id === ignoreEventId)) continue;
    const start = toMs(event.start, timezone);
    const end = toMs(event.end, timezone);
    if (start == null || end == null || end <= start) continue;
    if (isAvailabilityBlock(event.summary)) {
      windows.push({ start, end });
      continue;
    }
    if (event.transparency === "transparent") continue;
    busy.push({ start, end });
  }
  return { busy, windows };
};

export const readBusy = async (
  config: WhatsAppBookingConfig,
  from: Date,
  to: Date,
  timezone: string
): Promise<Busy[]> => (await readCalendar(config, from, to, timezone)).busy;

export const availableSlots = async (input: {
  config: WhatsAppBookingConfig;
  durationMin: number;
  timezone: string;
  from?: Date;
  to?: Date;
  now?: Date;
  /** Cuántas horas libres como mucho (por defecto 40: las primeras). */
  limit?: number;
}): Promise<Slot[]> => {
  const now = input.now ?? new Date();
  const until = new Date(now.getTime() + input.config.horizonDays * DAY);
  const { busy, windows } = await readCalendar(input.config, now, until, input.timezone);
  return findFreeSlots({
    config: input.config,
    durationMin: input.durationMin,
    busy,
    windows,
    timezone: input.timezone,
    now,
    from: input.from,
    to: input.to,
    limit: input.limit,
  });
};

export class SlotUnavailableError extends Error {}

/**
 * Crea la cita. Antes vuelve a mirar el calendario: entre que la IA ofreció la
 * hora y la persona dijo «sí» pudo pasar un rato, y Dayana pudo apuntar algo
 * desde el celular.
 */
export const bookOnCalendar = async (input: {
  config: WhatsAppBookingConfig;
  timezone: string;
  start: Date;
  durationMin: number;
  service: string;
  name: string | null;
  phone: string;
  conversationId: string;
  contactId?: string | null;
}): Promise<{
  accountId: string;
  eventId: string;
  meetUrl: string | null;
  eventUrl: string | null;
  title: string;
  end: Date;
}> => {
  const end = new Date(input.start.getTime() + input.durationMin * 60_000);
  const minStart =
    Date.now() + input.config.minNoticeHours * 60 * 60_000 - 60_000;
  if (input.start.getTime() < minStart) {
    throw new SlotUnavailableError("Esa hora está demasiado cerca.");
  }
  const { account: acc, token } = await account(input.config);
  const { busy, windows } = await readCalendar(
    input.config,
    new Date(input.start.getTime() - DAY),
    new Date(end.getTime() + DAY),
    input.timezone
  );
  // Con bloques «Disponible» en el calendario, la cita tiene que caber en uno;
  // y siempre dentro del horario de Ajustes, que es un límite duro.
  const inWindow =
    windows.length === 0 || windows.some((w) => input.start.getTime() >= w.start && end.getTime() <= w.end);
  const inHours =
    (windows.length > 0 && input.config.hours.length === 0) ||
    isWithinBookingHours(input.config, input.start, input.durationMin, input.timezone);
  const fits = inWindow && inHours;
  if (!fits) {
    throw new SlotUnavailableError("Esa hora está fuera del horario en que Dayana atiende.");
  }
  if (overlapsBusy(input.start.getTime(), end.getTime(), busy, input.config.bufferMin)) {
    throw new SlotUnavailableError("Esa hora ya se ocupó.");
  }

  // Título con la forma de Dayana: `X/Y Nombre +teléfono`.
  const [contact, enrollment] = input.contactId
    ? await Promise.all([
        prisma.contact.findUnique({
          where: { id: input.contactId },
          select: { firstName: true, lastName: true },
        }),
        prisma.enrollment.findFirst({
          where: { contactId: input.contactId, status: "ACTIVE", sessionsTotal: { gt: 0 } },
          orderBy: { createdAt: "desc" },
          select: { sessionsUsed: true, sessionsTotal: true },
        }),
      ])
    : [null, null];
  const crmName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  const title = buildEventTitle({
    name: crmName || input.name,
    phone: input.phone,
    enrollment,
    freeCall: isFreeCallService(input.service, input.durationMin),
  });
  const digits = input.phone.replace(/\D/g, "");
  const event = await createEvent(token, {
    summary: title,
    description: [
      input.service,
      `WhatsApp: https://wa.me/${digits}`,
      `Chat en el CRM: ${getSiteUrl()}/admin/whatsapp?conversation=${input.conversationId}`,
      "Agendada por el asistente de WhatsApp.",
    ].join("\n"),
    startIso: input.start.toISOString(),
    endIso: end.toISOString(),
    timeZone: input.timezone,
    withMeet: input.config.addMeet,
  });

  return {
    accountId: acc.id,
    eventId: event.id,
    meetUrl: event.hangoutLink ?? null,
    eventUrl: event.htmlLink ?? null,
    title,
    end,
  };
};

/**
 * Mueve una cita que ya existe a otra hora (la persona pidió otra hora para su
 * llamada gratis: Alexandra, 21-oct, quedó con el jueves cuando pidió el
 * viernes). Las mismas comprobaciones que al crearla, sin contar la propia
 * cita como ocupada. Solo cambia la hora del evento: título y descripción
 * quedan.
 */
export const moveOnCalendar = async (input: {
  config: WhatsAppBookingConfig;
  timezone: string;
  eventId: string;
  start: Date;
  durationMin: number;
}): Promise<{ end: Date }> => {
  const end = new Date(input.start.getTime() + input.durationMin * 60_000);
  if (input.start.getTime() < Date.now() + input.config.minNoticeHours * 60 * 60_000 - 60_000) {
    throw new SlotUnavailableError("Esa hora está demasiado cerca.");
  }
  const { token } = await account(input.config);
  const { busy, windows } = await readCalendar(
    input.config,
    new Date(input.start.getTime() - DAY),
    new Date(end.getTime() + DAY),
    input.timezone,
    input.eventId
  );
  const inWindow =
    windows.length === 0 || windows.some((w) => input.start.getTime() >= w.start && end.getTime() <= w.end);
  const inHours =
    (windows.length > 0 && input.config.hours.length === 0) ||
    isWithinBookingHours(input.config, input.start, input.durationMin, input.timezone);
  if (!(inWindow && inHours)) throw new SlotUnavailableError("Esa hora está fuera del horario en que Dayana atiende.");
  if (overlapsBusy(input.start.getTime(), end.getTime(), busy, input.config.bufferMin)) {
    throw new SlotUnavailableError("Esa hora ya se ocupó.");
  }
  await patchEventTime(token, input.eventId, { startIso: input.start.toISOString(), endIso: end.toISOString(), timeZone: input.timezone });
  return { end };
};
