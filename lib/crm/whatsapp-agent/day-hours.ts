import { prisma } from "@/lib/db";
import { getDateKeyInTz, getTimeHmInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { applyConfigPatch } from "./config-patch";

/**
 * «Hoy solo de 5 a 7», «el sábado no agendes»: the hours of ONE date, in the
 * operative zone (`booking.dateHours`). The WhatsApp AI's hours come from code
 * (`rangesForDate` in slots.ts), so this is the only way such an order reaches
 * what it offers, books and moves — a sentence in `instructions` never did
 * (Negra, 8-nov: offered and booked 12:15 and 1:15 after «solo de 5 a 7»).
 * Past dates are dropped on every write.
 */

export type DayRange = { from: string; to: string };

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const validateDayHours = (date: string, ranges: DayRange[], today: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "La fecha va como AAAA-MM-DD.";
  if (date < today) return "Esa fecha ya pasó.";
  for (const r of ranges) {
    if (!HM.test(r.from) || !HM.test(r.to)) return "Las horas van como HH:MM (24 h).";
    if (r.from >= r.to) return `La franja ${r.from}–${r.to} termina antes de empezar.`;
  }
  return null;
};

export const setBookingDayHours = async (input: {
  date: string;
  /** Empty = nothing is booked that day. */
  ranges: DayRange[];
  note?: string;
  /** Back to the weekday's normal hours. */
  remove?: boolean;
}) => {
  const [config, tz] = await Promise.all([getWhatsAppAiConfig(), getOperationalTimezone()]);
  const today = getDateKeyInTz(new Date(), tz);
  const invalid = input.remove ? null : validateDayHours(input.date, input.ranges, today);
  if (invalid) return { ok: false as const, error: invalid };

  const kept = config.booking.dateHours.filter((d) => d.date >= today && d.date !== input.date);
  const next = input.remove
    ? kept
    : [...kept, { date: input.date, ranges: [...input.ranges].sort((a, b) => a.from.localeCompare(b.from)), ...(input.note ? { note: input.note } : {}) }].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
  const result = await applyConfigPatch({ booking: { dateHours: next } });
  if (!result.ok) return { ok: false as const, error: result.error };

  // Calls already booked that day outside the new hours: they stay booked
  // (moving them is Dayana's call), but she has to know.
  const dayStart = zonedDateTimeToUtc(input.date, "00:00", tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const booked = await prisma.calendarAppointment.findMany({
    where: { status: "active", startsAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { startsAt: "asc" },
    select: { id: true, title: true, startsAt: true, endsAt: true, conversationId: true },
  });
  const ranges = input.remove ? null : input.ranges;
  const outside = ranges
    ? booked.filter((a) => {
        const from = getTimeHmInTz(a.startsAt, tz);
        const to = getTimeHmInTz(a.endsAt, tz);
        return !ranges.some((r) => from >= r.from && to <= r.to);
      })
    : [];
  return {
    ok: true as const,
    date: input.date,
    timezone: tz,
    ranges: input.remove ? "horario normal de ese día" : ranges!.length ? ranges : "cerrado",
    alreadyBookedOutside: outside.map((a) => ({
      title: a.title,
      at: getTimeHmInTz(a.startsAt, tz),
      ...(a.conversationId ? { chat: `/admin/whatsapp?conversation=${a.conversationId}` } : {}),
    })),
  };
};
