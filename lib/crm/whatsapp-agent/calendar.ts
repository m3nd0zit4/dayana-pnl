import { resolveGoogleAccount } from "@/agent/lib/google";
import { createEvent, listEvents } from "@/lib/google/calendar";
import { getSiteUrl } from "@/lib/site-url";
import type { WhatsAppBookingConfig } from "../whatsapp-ai-config";
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

const toMs = (value?: { dateTime?: string; date?: string }): number | null => {
  if (value?.dateTime) return new Date(value.dateTime).getTime();
  // Todo el día: la fecha sola. Se toma como día completo en UTC-5, que es
  // de sobra para no ofrecer horas un día que Dayana bloqueó entero.
  if (value?.date) return new Date(`${value.date}T00:00:00-05:00`).getTime();
  return null;
};

export const readBusy = async (
  config: WhatsAppBookingConfig,
  from: Date,
  to: Date
): Promise<Busy[]> => {
  const { token } = await account(config);
  const events = await listEvents(token, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    maxResults: 250,
  });
  const busy: Busy[] = [];
  for (const event of events) {
    if (event.status === "cancelled" || event.transparency === "transparent") {
      continue;
    }
    const start = toMs(event.start);
    const end = toMs(event.end);
    if (start != null && end != null && end > start) busy.push({ start, end });
  }
  return busy;
};

export const availableSlots = async (input: {
  config: WhatsAppBookingConfig;
  durationMin: number;
  timezone: string;
  from?: Date;
  to?: Date;
  now?: Date;
}): Promise<Slot[]> => {
  const now = input.now ?? new Date();
  const until = new Date(now.getTime() + input.config.horizonDays * DAY);
  const busy = await readBusy(input.config, now, until);
  return findFreeSlots({
    config: input.config,
    durationMin: input.durationMin,
    busy,
    timezone: input.timezone,
    now,
    from: input.from,
    to: input.to,
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
}): Promise<{
  accountId: string;
  eventId: string;
  meetUrl: string | null;
  end: Date;
}> => {
  const end = new Date(input.start.getTime() + input.durationMin * 60_000);
  const minStart =
    Date.now() + input.config.minNoticeHours * 60 * 60_000 - 60_000;
  if (input.start.getTime() < minStart) {
    throw new SlotUnavailableError("Esa hora está demasiado cerca.");
  }
  if (
    !isWithinBookingHours(
      input.config,
      input.start,
      input.durationMin,
      input.timezone
    )
  ) {
    throw new SlotUnavailableError("Esa hora está fuera del horario de citas.");
  }

  const { account: acc, token } = await account(input.config);
  const busy = await readBusy(
    input.config,
    new Date(input.start.getTime() - DAY / 2),
    new Date(end.getTime() + DAY / 2)
  );
  if (
    overlapsBusy(input.start.getTime(), end.getTime(), busy, input.config.bufferMin)
  ) {
    throw new SlotUnavailableError("Esa hora ya se ocupó.");
  }

  const who = input.name?.trim() || `+${input.phone}`;
  const event = await createEvent(token, {
    summary: `${input.service} — ${who}`,
    description: [
      `Agendada por el asistente de WhatsApp.`,
      `WhatsApp: +${input.phone}`,
      `Chat en el CRM: ${getSiteUrl()}/admin/whatsapp?conversation=${input.conversationId}`,
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
    end,
  };
};
