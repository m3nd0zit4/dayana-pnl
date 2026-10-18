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
        // The schedule in Ajustes is a hard limit (no Tuesdays, nothing late…):
        // a «Disponible» block outside it doesn't open those hours.
        if (config.hours.length > 0 && !isWithinBookingHours(config, start, durationMin, timezone)) continue;
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

/** mañana (antes de las 12), tarde (12 a 7 p. m.) o noche, con la hora «HH:MM». */
export type PartOfDay = "manana" | "tarde" | "noche";
export const partOfDay = (hm: string): PartOfDay => {
  const h = Number(hm.slice(0, 2));
  return h >= 5 && h < 12 ? "manana" : h >= 12 && h < 19 ? "tarde" : "noche";
};

/**
 * Como `spreadSlots`, pero dentro de un mismo día varía la franja: con hoy y
 * mañana libres sale una de hoy, una de mañana y otra de hoy en la tarde (no
 * 8:00 y 8:15 seguidas).
 */
const spreadVaried = (slots: Slot[], count: number): Slot[] => {
  if (count <= 0) return [];
  if (slots.length <= count) return slots;
  const picked: Slot[] = [];
  const usedDays = new Set<string>();
  const usedParts = new Set<string>();
  const take = (s: Slot) => {
    picked.push(s);
    usedDays.add(s.dateKey);
    usedParts.add(`${s.dateKey}|${partOfDay(s.time)}`);
  };
  for (const s of slots) if (picked.length < count && !usedDays.has(s.dateKey)) take(s);
  for (const s of slots) if (picked.length < count && !picked.includes(s) && !usedParts.has(`${s.dateKey}|${partOfDay(s.time)}`)) take(s);
  for (const s of slots) if (picked.length < count && !picked.includes(s)) take(s);
  return picked;
};

const weekdayOfKey = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();

/**
 * Las horas de la llamada gratis que se ofrecen (pedido de la dueña, 17-oct):
 * primero hoy o mañana si hay espacio, luego sus días preferidos y luego
 * cualquier otro día del horario. Los días que ya llegaron al tope de llamadas
 * gratis no se ofrecen.
 */
export const pickFreeCallSlots = (
  slots: Slot[],
  p: {
    count: number;
    /** Zona de Dayana (la de `Slot.dateKey`). */
    timezone: string;
    now: Date;
    soonFirst: boolean;
    /** 0 = domingo. Vacío: sin preferencia. */
    preferredWeekdays: number[];
    /** Días («YYYY-MM-DD», zona de Dayana) sin cupo de llamada gratis. */
    fullDays?: Set<string>;
  }
): Slot[] => {
  const open = p.fullDays?.size ? slots.filter((s) => !p.fullDays!.has(s.dateKey)) : slots;
  const soonKeys = p.soonFirst
    ? new Set([getDateKeyInTz(p.now, p.timezone), getDateKeyInTz(new Date(p.now.getTime() + DAY), p.timezone)])
    : new Set<string>();
  const preferred = new Set(p.preferredWeekdays);
  const soon = open.filter((s) => soonKeys.has(s.dateKey));
  const liked = open.filter((s) => !soonKeys.has(s.dateKey) && preferred.has(weekdayOfKey(s.dateKey)));
  const rest = open.filter((s) => !soonKeys.has(s.dateKey) && !preferred.has(weekdayOfKey(s.dateKey)));
  const picked: Slot[] = [];
  for (const group of [soon, liked, rest]) picked.push(...spreadVaried(group, p.count - picked.length));
  return picked.sort((a, b) => a.startIso.localeCompare(b.startIso));
};

/**
 * Cuándo puede la persona (lo que dijo: «solo los martes», «el jueves en la
 * tarde», «la otra semana», «el lunes no puedo»), en SU hora.
 */
export type SlotWish = {
  /** Días que puede, 0 = domingo. */
  weekdays?: number[];
  /** Fechas que puede, «YYYY-MM-DD». */
  dates?: string[];
  notWeekdays?: number[];
  notDates?: string[];
  partOfDay?: PartOfDay;
  /** Desde esta fecha («YYYY-MM-DD»). */
  fromDate?: string;
};

export const hasWish = (w: SlotWish | null | undefined): w is SlotWish =>
  Boolean(
    w &&
      (w.weekdays?.length || w.dates?.length || w.notWeekdays?.length || w.notDates?.length || w.partOfDay || w.fromDate)
  );

const WEEKDAY_WORDS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/**
 * Lo que la asistente le pasa a `offer_free_call_slots` («martes», «hoy»,
 * «mañana», «2026-10-22»; franja «mañana» / «tarde» / «noche»; «desde») a un
 * `SlotWish` en la hora de la persona. Lo que no entiende se ignora.
 */
export const wishFromWords = (
  input: { dias?: string[]; noPuede?: string[]; franja?: string; desde?: string },
  personTz: string,
  now: Date
): SlotWish => {
  const today = getDateKeyInTz(now, personTz);
  const tomorrow = getDateKeyInTz(new Date(now.getTime() + DAY), personTz);
  const read = (words: string[] | undefined) => {
    const weekdays: number[] = [];
    const dates: string[] = [];
    for (const raw of words ?? []) {
      const w = fold(raw);
      if (w === "hoy") dates.push(today);
      else if (w === "manana" || w === "pasado manana") dates.push(w === "manana" ? tomorrow : getDateKeyInTz(new Date(now.getTime() + 2 * DAY), personTz));
      else if (w in WEEKDAY_WORDS) weekdays.push(WEEKDAY_WORDS[w]!);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(w)) dates.push(w);
    }
    return { weekdays, dates };
  };
  const yes = read(input.dias);
  const no = read(input.noPuede);
  const franja = input.franja ? fold(input.franja) : "";
  const part: PartOfDay | undefined =
    franja === "manana" ? "manana" : franja === "tarde" ? "tarde" : franja === "noche" ? "noche" : undefined;
  const desde = input.desde ? fold(input.desde) : "";
  return {
    ...(yes.weekdays.length ? { weekdays: yes.weekdays } : {}),
    ...(yes.dates.length ? { dates: yes.dates } : {}),
    ...(no.weekdays.length ? { notWeekdays: no.weekdays } : {}),
    ...(no.dates.length ? { notDates: no.dates } : {}),
    ...(part ? { partOfDay: part } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(desde) ? { fromDate: desde } : {}),
  };
};

/** ¿Esta hora le sirve a la persona? Se mira en su zona. */
export const matchesWish = (slot: Slot, wish: SlotWish, personTz: string): boolean => {
  const start = new Date(slot.startIso);
  const key = getDateKeyInTz(start, personTz);
  const weekday = weekdayOfKey(key);
  if (wish.fromDate && key < wish.fromDate) return false;
  if (wish.notDates?.includes(key) || wish.notWeekdays?.includes(weekday)) return false;
  const byDay = Boolean(wish.dates?.length || wish.weekdays?.length);
  if (byDay && !(wish.dates?.includes(key) || wish.weekdays?.includes(weekday))) return false;
  if (wish.partOfDay && partOfDay(getTimeHmInTz(start, personTz)) !== wish.partOfDay) return false;
  return true;
};

/**
 * Si en lo que pidió no hay espacio, lo más parecido, en orden: los mismos días
 * a otra hora, la misma parte del día otro día, y cualquier hora. Lo que dijo
 * que NO puede (días, desde cuándo) se respeta siempre. Danilo (18-oct) pidió
 * «mañana en la tarde», la tarde del lunes estaba llena y le salieron horas de
 * ese mismo domingo en vez de otras horas del lunes o la tarde del miércoles.
 */
export type WishStep = "exact" | "same_days" | "same_time" | "any";

export const relaxedWishes = (wish: SlotWish): { step: WishStep; wish: SlotWish }[] => {
  const keep: SlotWish = { notWeekdays: wish.notWeekdays, notDates: wish.notDates, fromDate: wish.fromDate };
  const byDay = Boolean(wish.dates?.length || wish.weekdays?.length);
  const steps: { step: WishStep; wish: SlotWish }[] = [{ step: "exact", wish }];
  if (byDay && wish.partOfDay) {
    steps.push({ step: "same_days", wish: { ...keep, weekdays: wish.weekdays, dates: wish.dates } });
    steps.push({ step: "same_time", wish: { ...keep, partOfDay: wish.partOfDay } });
  }
  steps.push({ step: "any", wish: keep });
  return steps;
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
