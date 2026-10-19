import {
  getDateKeyInTz,
  getTimeHmInTz,
  getTimeLabelInTz,
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
  /**
   * Por cuántos lados queda pegada a algo ocupado (0, 1 o 2): 2 es un hueco
   * justo entre dos citas. Sirve para juntar las llamadas (`compact`).
   */
  snug?: number;
};

const hmToMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

const minutesToHm = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/** Paso entre inicios posibles: cada media hora, o cada cita si es más corta. */
const stepMinutes = (duration: number): number => Math.min(30, duration);

/** Lo primero que se puede ofrecer después de algo ocupado: fin + respiro, redondeado a 5 minutos. */
const afterBusyStart = (endMs: number, bufferMin: number): number => Math.ceil((endMs + bufferMin * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;

/** Lo último que cabe antes de algo ocupado: su inicio − respiro − la cita, redondeado hacia atrás a 5 minutos. */
const beforeBusyStart = (startMs: number, bufferMin: number, durationMin: number): number =>
  Math.floor((startMs - (bufferMin + durationMin) * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;

/**
 * Con «Antelación mínima» en 0 (19-oct, Dayana: «lo más que se pueda»), igual
 * no se ofrece una hora que empieza en 2 minutos: la persona no alcanza a
 * leerla. Para ofrecer, al menos esto; para agendar, `BOOK_SOONEST_MIN`.
 */
export const OFFER_SOONEST_MIN = 15;
export const BOOK_SOONEST_MIN = 5;

/** ¿Por cuántos lados (0–2) queda pegada a algo ocupado, contando el respiro? */
const snugness = (startMs: number, endMs: number, busy: Busy[], bufferMin: number): number => {
  const guard = bufferMin * MINUTE;
  const close = 5 * MINUTE;
  const after = busy.some((b) => startMs - (b.end + guard) >= 0 && startMs - (b.end + guard) < close);
  const before = busy.some((b) => b.start - guard - endMs >= 0 && b.start - guard - endMs < close);
  return Number(after) + Number(before);
};

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
    now.getTime() + Math.max(config.minNoticeHours * 60, OFFER_SOONEST_MIN) * MINUTE,
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
      const grid: number[] = [];
      for (let t = w.start; t + durationMin * MINUTE <= w.end; t += step * MINUTE) grid.push(t);
      const extra = busy
        .flatMap((b) => [afterBusyStart(b.end, config.bufferMin), beforeBusyStart(b.start, config.bufferMin, durationMin)])
        .filter((t) => t > w.start && t + durationMin * MINUTE <= w.end);
      for (const t of [...new Set([...grid, ...extra])].sort((a, b) => a - b)) {
        if (slots.length >= limit) break;
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
          snug: snugness(t, endMs, busy, config.bufferMin),
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
    // Además de la cuadrícula, justo después de cada cita + el respiro (19-oct:
    // Dayana bajó «Respiro entre citas» a 7 min y se seguían ofreciendo las de
    // cada 15: tras una llamada de 12:00 a 12:15, las 12:30 y no las 12:25), y
    // lo último que cabe antes de cada una (una sesión a las 11:10 → 10:55).
    const afterBusy = busy
      .flatMap((b) => [afterBusyStart(b.end, config.bufferMin), beforeBusyStart(b.start, config.bufferMin, durationMin)])
      .map((t) => new Date(t))
      .filter((d) => getDateKeyInTz(d, timezone) === dateKey)
      .map((d) => hmToMinutes(getTimeHmInTz(d, timezone)));
    for (const range of ranges) {
      const grid: number[] = [];
      for (let m = range.from; m + durationMin <= range.to; m += step) grid.push(m);
      const starts = [...new Set([...grid, ...afterBusy.filter((m) => m > range.from && m + durationMin <= range.to)])].sort((a, b) => a - b);
      for (const m of starts) {
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
          snug: snugness(startMs, endMs, busy, config.bufferMin),
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
const spreadVaried = (slots: Slot[], count: number, already: Slot[] = []): Slot[] => {
  if (count <= 0) return [];
  if (slots.length <= count) return slots;
  const picked: Slot[] = [];
  // Lo ya elegido en otro grupo cuenta para variar (día y franja).
  const usedDays = new Set<string>(already.map((s) => s.dateKey));
  const usedParts = new Set<string>(already.map((s) => `${s.dateKey}|${partOfDay(s.time)}`));
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

/**
 * Juntando (19-oct, Dayana: «las más juntas, que pueda hacer cuatro llamadas
 * en una hora»): la primera es la más pegada a una cita (un hueco entre dos
 * antes que una al lado de una sola) y cada siguiente la más cercana a las ya
 * elegidas, sin cruzarse con ellas. Con el live hasta las 7:00 p. m., una
 * llamada a las 7:15 y otra a las 8:00 salen 7:00, 7:30 y 7:45 (no 3:00, 3:45
 * y 7:00, repartidas en la tarde).
 */
const clustered = (slots: Slot[], count: number, already: Slot[]): Slot[] => {
  const ms = (iso: string) => new Date(iso).getTime();
  const gap = (a: Slot, b: Slot) => Math.max(0, ms(a.startIso) - ms(b.endIso), ms(b.startIso) - ms(a.endIso));
  const crosses = (a: Slot, b: Slot) => ms(a.startIso) < ms(b.endIso) && ms(b.startIso) < ms(a.endIso);
  const byTime = [...slots].sort((a, b) => a.startIso.localeCompare(b.startIso));
  const picked: Slot[] = [];
  while (picked.length < count) {
    const chosen = [...already, ...picked];
    const near = (s: Slot) => (chosen.length ? Math.min(...chosen.map((c) => gap(s, c))) : 0);
    // En empate, la más pegada a una cita y después la más temprana.
    const best = byTime
      .filter((s) => !chosen.some((c) => crosses(s, c)))
      .reduce<Slot | null>((a, s) => (!a || near(s) < near(a) || (near(s) === near(a) && (s.snug ?? 0) > (a.snug ?? 0)) ? s : a), null);
    if (!best) break;
    picked.push(best);
  }
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
    /**
     * Juntar las llamadas (19-oct, Dayana: «que se agenden lo más que se pueda
     * en una hora»): en cada grupo van primero los huecos entre dos citas y
     * las horas pegadas a una, todas juntas (`clustered`), así la agenda se
     * llena sin ratos muertos.
     */
    compact?: boolean;
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
  // Juntando: dentro de cada grupo, primero las pegadas a una cita y luego el
  // resto, todas lo más juntas posible (`clustered`).
  const picked: Slot[] = [];
  for (const group of [soon, liked, rest]) {
    if (!p.compact) picked.push(...spreadVaried(group, p.count - picked.length, picked));
    else for (const tier of [group.filter((s) => (s.snug ?? 0) > 0), group.filter((s) => !s.snug)]) picked.push(...clustered(tier, p.count - picked.length, picked));
  }
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
  /**
   * Una hora exacta que propuso («¿puede ser a las 3:15?»), en su hora: "15:15",
   * o "03:15" y "15:15" si no dijo a. m./p. m.
   */
  times?: string[];
};

export const hasWish = (w: SlotWish | null | undefined): w is SlotWish =>
  Boolean(
    w &&
      (w.weekdays?.length || w.dates?.length || w.notWeekdays?.length || w.notDates?.length || w.partOfDay || w.fromDate || w.times?.length)
  );

/**
 * «15:15», «3:15 pm», «3:15 p. m.», «9 am» → ["15:15"]… Sin a. m./p. m. y antes
 * de las 12 valen las dos («3:15» → ["03:15", "15:15"]). Si no se entiende, [].
 */
export const readClock = (raw: string | undefined): string[] => {
  const m = fold(raw ?? "").match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(?:([ap])\.?\s?m\.?)?$/);
  if (!m) return [];
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return [];
  if (m[3] === "p" && h < 12) h += 12;
  if (m[3] === "a" && h === 12) h = 0;
  const hm = (x: number) => `${String(x).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return !m[3] && h >= 1 && h < 12 ? [hm(h), hm(h + 12)] : [hm(h)];
};

// «No puedo a las 10», «a las 10 no me sirve».
const NOT_ABLE = /\b(no|tampoco) (puedo|podre|podria|me (sirve|queda|da|funciona)|alcanzo|estoy|estare)\b/;
const NOT_ABLE_AFTER = /^\W*(no|tampoco) (puedo|podre|podria|me (sirve|queda|da|funciona)|alcanzo|estoy|estare)\b/;

/**
 * La hora exacta que propone en su mensaje («mañana a las 4 de la tarde», «¿a
 * las 10:30?», «tipo 3pm»), lista para `readClock`. flash-lite a veces pasa solo
 * `franja: "tarde"` y contestó «a esa hora no tengo espacio» con las 4:00 libres
 * (e2e, 19-oct). No cuentan «después de / desde / antes de / hasta las 4» (no
 * es una hora exacta) ni una con «no» cerca («a las 10 no puedo»). Del último
 * mensaje que tenga una, la última.
 */
export const clockInText = (texts: (string | null | undefined)[]): string | null => {
  const re =
    /\b(?:a las?|las) (\d{1,2})(?::(\d{2}))?(?:\s*([ap])\.?\s?m\b\.?|\s+(?:de|en|por) la (manana|tarde|noche))?|\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b/g;
  for (const raw of [...texts].reverse()) {
    const t = fold(raw ?? "");
    let found: string | null = null;
    for (const m of t.matchAll(re)) {
      // Solo la misma frase: en «a las 10 no puedo, mejor a las 4» las 4 valen.
      const before = t.slice(Math.max(0, m.index - 22), m.index).split(/[,.;!?]/).pop() ?? "";
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 14).split(/[,.;!?]/)[0] ?? "";
      if (/(despues de|desde|antes de|hasta)\s*$/.test(before) || NOT_ABLE.test(before) || NOT_ABLE_AFTER.test(after)) continue;
      const bare = m[1] === undefined;
      // «las 3» sin «a» ni minutos ni a. m./p. m./tarde puede ser cualquier cosa («me sirven las 2»).
      if (!bare && !m[0].startsWith("a ") && !m[2] && !m[3] && !m[4]) continue;
      const h = Number(bare ? m[5] : m[1]);
      const min = (bare ? m[6] : m[2]) ?? "00";
      if (h > 23 || Number(min) > 59) continue;
      const ampm = bare ? m[7] : m[3];
      found = ampm ? `${h}:${min} ${ampm}m` : m[4] === "manana" ? `${h}:${min} am` : m[4] ? `${h}:${min} pm` : `${h}:${min}`;
    }
    if (found) return found;
  }
  return null;
};

/** "16:00" → «4:00 p. m.», "00:30" → «12:30 a. m.» (como las escribe la asistente). */
export const clockLabel = (hm: string): string => {
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};

/** Minutos entre la hora de la cita (en la zona de la persona) y "HH:MM". */
export const minutesFromClock = (slot: Slot, clocks: string[], personTz: string): number => {
  const at = hmToMinutes(getTimeHmInTz(new Date(slot.startIso), personTz));
  return Math.min(...clocks.map((c) => Math.abs(at - hmToMinutes(c))));
};

const WEEKDAY_WORDS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/**
 * ¿Dayana le escribió esa hora en el chat? Con el botón «Horas libres» del CRM
 * («• Jueves, 15 de octubre, 6:45 p. m.») o a mano («el jueves a las 6:45 pm»).
 * Esas horas no pasan por `offer_free_call_slots` y `book_free_call` las
 * rechazaba (Dayanna, 14-oct: eligió «Jueves» y nadie le contestó). Mismo
 * día (fecha o día de la semana) y misma hora en la misma línea, en la zona
 * de Dayana.
 */
export const dayanaOfferedSlot = (texts: (string | null | undefined)[], startIso: string, timeZone: string): boolean => {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return false;
  const norm = (s: string) => fold(s).replace(/\b([ap])\.?\s?m\b\.?/g, "$1m").replace(/[ \t]+/g, " ");
  const time = norm(getTimeLabelInTz(d, timeZone));
  const weekday = fold(new Intl.DateTimeFormat("es-CO", { timeZone, weekday: "long" }).format(d));
  const dayMonth = fold(new Intl.DateTimeFormat("es-CO", { timeZone, day: "numeric", month: "long" }).format(d));
  const hasTime = (line: string) => new RegExp(`(^|[^\\d:])${time.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(line);
  return texts.some((raw) =>
    norm(raw ?? "")
      .split("\n")
      // Con fecha escrita, la fecha manda (otro jueves no vale); sin fecha, el día de la semana.
      .some((line) =>
        hasTime(line) && (/\b\d{1,2} de [a-z]+/.test(line) ? new RegExp(`(^|[^\\d])${dayMonth}\\b`).test(line) : new RegExp(`\\b${weekday}\\b`).test(line))
      )
  );
};

/**
 * ¿La persona habló de una parte del día («en la tarde», «por la mañana»,
 * «después de las 5», «6 pm»)? flash-lite pasa `franja: "tarde"` sin que lo
 * haya dicho (19-oct, e2e de la llamada gratis: preguntó «¿Qué horarios
 * tienes?» y solo le salió la hora de la tarde). «Mañana» solo es «mañana»;
 * «buenas tardes / noches» es un saludo.
 */
export const saidPartOfDay = (texts: (string | null | undefined)[]): boolean =>
  texts.some((raw) => {
    const t = fold(raw ?? "").replace(/\bbuen[oa]s (tardes|noches|dias)\b/g, " ");
    return /\b((en|por|de|a) la (manana|tarde|noche)|temprano|(en|por|de|a) las? (tardes|noches|mananas)|tarde|noche|mediodia|medio dia|(despues|antes) de las|\d{1,2}(:\d{2})?\s*(am|pm|a\s?m|p\s?m)\b)/.test(t);
  });

/**
 * Lo que la asistente le pasa a `offer_free_call_slots` («martes», «hoy»,
 * «mañana», «2026-10-22»; franja «mañana» / «tarde» / «noche»; «desde») a un
 * `SlotWish` en la hora de la persona. Lo que no entiende se ignora.
 */
export const wishFromWords = (
  input: { dias?: string[]; noPuede?: string[]; franja?: string; desde?: string; hora?: string },
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
  const times = readClock(input.hora);
  return {
    ...(yes.weekdays.length ? { weekdays: yes.weekdays } : {}),
    ...(yes.dates.length ? { dates: yes.dates } : {}),
    ...(no.weekdays.length ? { notWeekdays: no.weekdays } : {}),
    ...(no.dates.length ? { notDates: no.dates } : {}),
    // Con una hora exacta, la franja sobra (y flash-lite a veces la pone mal).
    ...(part && !times.length ? { partOfDay: part } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(desde) ? { fromDate: desde } : {}),
    ...(times.length ? { times } : {}),
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
  if (wish.times?.length && !wish.times.includes(getTimeHmInTz(start, personTz))) return false;
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
