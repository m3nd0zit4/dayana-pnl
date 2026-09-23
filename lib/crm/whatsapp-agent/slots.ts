import {
  getDateKeyInTz,
  getTimeHmInTz,
  zonedDateTimeToUtc,
} from "@/lib/datetime/zoned-time";
import type { WhatsAppBookingConfig } from "../whatsapp-ai-config";

/**
 * Huecos libres para agendar, sin tocar red ni base de datos.
 *
 * Recibe lo ocupado ya resuelto (eventos del calendario de Dayana) para poder
 * probarse con fechas fijas. La lógica viene de la agenda pública que se
 * retiró (commit 6c47752): un hueco tiene que caber entero —cita más respiro—
 * dentro de una franja del horario y no pisar nada ocupado. El respiro cuenta
 * a los dos lados: una cita que termina a las 10:00 no deja libres las 10:00.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type Busy = { start: number; end: number };

export type Slot = {
  startIso: string;
  endIso: string;
  /** "2026-09-25" en la zona operativa. */
  dateKey: string;
  /** "15:30" en la zona operativa. */
  time: string;
};

const hmToMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

const minutesToHm = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/** Paso entre inicios posibles: cada media hora, o cada cita si es más corta. */
const stepMinutes = (duration: number): number => Math.min(30, duration);

export const overlapsBusy = (
  startMs: number,
  endMs: number,
  busy: Busy[],
  bufferMin: number
): boolean => {
  const guard = bufferMin * MINUTE;
  return busy.some((b) => startMs - guard < b.end && endMs + guard > b.start);
};

export const findFreeSlots = (input: {
  config: Pick<
    WhatsAppBookingConfig,
    "hours" | "bufferMin" | "minNoticeHours" | "horizonDays"
  >;
  durationMin: number;
  busy: Busy[];
  timezone: string;
  now: Date;
  /** Desde cuándo buscar (por defecto, ahora + antelación mínima). */
  from?: Date;
  /** Hasta cuándo (por defecto, el horizonte configurado). */
  to?: Date;
  limit?: number;
  /**
   * Bloques «Disponible» del Google Calendar de Dayana. Si hay, mandan: solo
   * se ofrecen horas dentro de ellos, y el horario base no se usa.
   */
  windows?: Busy[];
}): Slot[] => {
  const { config, durationMin, busy, timezone, now } = input;
  const earliest = Math.max(
    now.getTime() + config.minNoticeHours * 60 * MINUTE,
    input.from?.getTime() ?? 0
  );
  const horizon = now.getTime() + config.horizonDays * DAY;
  const latest = Math.min(horizon, input.to?.getTime() ?? horizon);
  const limit = input.limit ?? 40;
  if (latest <= earliest) return [];

  const byWeekday = new Map<number, { from: number; to: number }[]>();
  for (const rule of config.hours) {
    const list = byWeekday.get(rule.weekday) ?? [];
    list.push({ from: hmToMinutes(rule.from), to: hmToMinutes(rule.to) });
    byWeekday.set(rule.weekday, list);
  }

  const slots: Slot[] = [];
  const step = stepMinutes(durationMin);

  if (input.windows && input.windows.length > 0) {
    const sorted = [...input.windows].sort((a, b) => a.start - b.start);
    for (const w of sorted) {
      for (let t = w.start; t + durationMin * MINUTE <= w.end && slots.length < limit; t += step * MINUTE) {
        const endMs = t + durationMin * MINUTE;
        if (t < earliest || endMs > latest) continue;
        if (overlapsBusy(t, endMs, busy, config.bufferMin)) continue;
        const start = new Date(t);
        if (slots.some((x) => x.startIso === start.toISOString())) continue;
        slots.push({
          startIso: start.toISOString(),
          endIso: new Date(endMs).toISOString(),
          dateKey: getDateKeyInTz(start, timezone),
          time: getTimeHmInTz(start, timezone),
        });
      }
    }
    return slots;
  }
  const days = Math.ceil((latest - now.getTime()) / DAY) + 1;

  for (let i = 0; i <= days && slots.length < limit; i++) {
    const dateKey = getDateKeyInTz(new Date(now.getTime() + i * DAY), timezone);
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    const ranges = [...(byWeekday.get(weekday) ?? [])].sort(
      (a, b) => a.from - b.from
    );
    for (const range of ranges) {
      for (let m = range.from; m + durationMin <= range.to; m += step) {
        let start: Date;
        try {
          start = zonedDateTimeToUtc(dateKey, minutesToHm(m), timezone);
        } catch {
          continue;
        }
        const startMs = start.getTime();
        const endMs = startMs + durationMin * MINUTE;
        if (startMs < earliest || endMs > latest) continue;
        if (overlapsBusy(startMs, endMs, busy, config.bufferMin)) continue;
        if (slots.some((s) => s.startIso === start.toISOString())) continue;
        slots.push({
          startIso: start.toISOString(),
          endIso: new Date(endMs).toISOString(),
          dateKey,
          time: getTimeHmInTz(start, timezone),
        });
        if (slots.length >= limit) break;
      }
    }
  }
  return slots;
};

/**
 * Elige pocas opciones repartidas: la primera libre y luego saltando de día o
 * de franja, para que la persona tenga dónde escoger sin una lista eterna.
 */
export const spreadSlots = (slots: Slot[], count = 3): Slot[] => {
  if (slots.length <= count) return slots;
  const picked: Slot[] = [];
  const usedDays = new Set<string>();
  for (const slot of slots) {
    if (picked.length >= count) break;
    if (usedDays.has(slot.dateKey)) continue;
    picked.push(slot);
    usedDays.add(slot.dateKey);
  }
  for (const slot of slots) {
    if (picked.length >= count) break;
    if (!picked.includes(slot)) picked.push(slot);
  }
  return picked.sort((a, b) => a.startIso.localeCompare(b.startIso));
};

/** ¿Encaja este inicio en el horario configurado? */
export const isWithinBookingHours = (
  config: Pick<WhatsAppBookingConfig, "hours">,
  start: Date,
  durationMin: number,
  timezone: string
): boolean => {
  const dateKey = getDateKeyInTz(start, timezone);
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  const startMin = hmToMinutes(getTimeHmInTz(start, timezone));
  return config.hours.some(
    (r) =>
      r.weekday === weekday &&
      startMin >= hmToMinutes(r.from) &&
      startMin + durationMin <= hmToMinutes(r.to)
  );
};
