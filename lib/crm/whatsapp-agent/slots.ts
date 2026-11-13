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
};

const hmToMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

const minutesToHm = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

type HoursConfig = Pick<WhatsAppBookingConfig, "hours"> & { dateHours?: WhatsAppBookingConfig["dateHours"] };

/**
 * Las franjas de un día (minutos desde las 00:00, zona operativa): las de esa
 * fecha si Dayana puso un horario especial (`dateHours`, vacío = cerrado), si no
 * las de su día de la semana.
 */
export const rangesForDate = (config: HoursConfig, dateKey: string): { from: number; to: number }[] => {
  const special = config.dateHours?.find((d) => d.date === dateKey);
  if (special) return special.ranges.map((r) => ({ from: hmToMinutes(r.from), to: hmToMinutes(r.to) })).sort((a, b) => a.from - b.from);
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return config.hours
    .filter((r) => r.weekday === weekday)
    .map((r) => ({ from: hmToMinutes(r.from), to: hmToMinutes(r.to) }))
    .sort((a, b) => a.from - b.from);
};

/** Paso entre inicios posibles: cada media hora, o cada cita si es más corta. */
const stepMinutes = (duration: number): number => Math.min(30, duration);

/** Lo primero que se puede ofrecer después de algo ocupado: fin + respiro, redondeado a 5 minutos. */
const afterBusyStart = (endMs: number, bufferMin: number): number => Math.ceil((endMs + bufferMin * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;

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
  > & { dateHours?: WhatsAppBookingConfig["dateHours"] };
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

  const slots: Slot[] = [];
  const step = stepMinutes(durationMin);

  if (input.windows && input.windows.length > 0) {
    const sorted = [...input.windows].sort((a, b) => a.start - b.start);
    for (const w of sorted) {
      const grid: number[] = [];
      for (let t = w.start; t + durationMin * MINUTE <= w.end; t += step * MINUTE) grid.push(t);
      const extra = busy.map((b) => afterBusyStart(b.end, config.bufferMin)).filter((t) => t > w.start && t + durationMin * MINUTE <= w.end);
      for (const t of [...new Set([...grid, ...extra])].sort((a, b) => a - b)) {
        if (slots.length >= limit) break;
        const endMs = t + durationMin * MINUTE;
        if (t < earliest || endMs > latest) continue;
        if (overlapsBusy(t, endMs, busy, config.bufferMin)) continue;
        const start = new Date(t);
        // The schedule in Ajustes is a hard limit (no Tuesdays, nothing late…):
        // a «Disponible» block outside it doesn't open those hours.
        if ((config.hours.length > 0 || (config.dateHours?.length ?? 0) > 0) && !isWithinBookingHours(config, start, durationMin, timezone)) continue;
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
    const ranges = rangesForDate(config, dateKey);
    // Además de la cuadrícula, justo después de cada cita + el respiro (19-oct:
    // Dayana bajó «Respiro entre citas» a 7 min y se seguían ofreciendo las de
    // cada 15: tras una llamada de 12:00 a 12:15, las 12:30 y no las 12:25).
    const afterBusy = busy
      .map((b) => new Date(afterBusyStart(b.end, config.bufferMin)))
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

/** Lo antes posible / un poco más adelante, cuando hay de los dos (12-nov). */
const SOON_COUNT = 2;
const LATER_COUNT = 2;

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
  // Con hoy/mañana Y días de más adelante (dueña, 12-nov: «si quieres una cita ya…
  // si no, unos un poquito más adelante»): dos de lo antes posible y dos de más
  // adelante (preferidos primero), para que elija; si falta un lado, como siempre.
  const later = [...liked, ...rest];
  if (p.soonFirst && soon.length > 0 && later.length > 0) {
    const likedPick = spreadVaried(liked, LATER_COUNT);
    picked.push(...spreadVaried(soon, SOON_COUNT), ...likedPick, ...spreadVaried(rest, LATER_COUNT - likedPick.length));
    return picked.sort((a, b) => a.startIso.localeCompare(b.startIso));
  }
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
  /** Desde esta hora, en su hora («17:00»: «después de las 5», «salgo a las 4»). */
  fromTime?: string;
  /** Hasta esta hora, en su hora («antes de las 10»). */
  toTime?: string;
  /** No a mediodía («no puedo a mediodía por mi trabajo»). */
  avoidMidday?: boolean;
};

export const hasWish = (w: SlotWish | null | undefined): w is SlotWish =>
  Boolean(
    w &&
      (w.weekdays?.length || w.dates?.length || w.notWeekdays?.length || w.notDates?.length || w.partOfDay || w.fromDate || w.fromTime || w.toTime || w.avoidMidday)
  );

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
  const hm = getTimeHmInTz(start, personTz);
  if (wish.partOfDay && partOfDay(hm) !== wish.partOfDay) return false;
  if (wish.fromTime && hm < wish.fromTime) return false;
  if (wish.toTime && hm >= wish.toTime) return false;
  if (wish.avoidMidday && hm >= "11:00" && hm < "14:00") return false;
  return true;
};

/**
 * Las horas que dijo que puede o no (Carito, 9 y 12-nov: «después de las 5 pm»,
 * «mi trabajo va desde 7 am a 4 pm», «no puedo a mediodía por mi trabajo» — le
 * salieron las 12:00 porque «tarde» incluye el mediodía). Lo más nuevo manda.
 * Sin a. m./p. m., de 1 a 7 es de la tarde («después de las 5» = 17:00).
 */
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?(?:\s*(a\.?\s?m|p\.?\s?m)\b\.?|\s+de\s+la\s+(manana|tarde|noche))?(?![\d:])(?!\s*(?:semanas?|dias?|meses|mes|horas?|veces|anos?|minutos?)\b)`;
/**
 * «5», «5 pm», «7 de la mañana» → «17:00»: con a. m./p. m. o «de la mañana/tarde/noche»
 * manda eso; sin nada, de 1 a 7 es de la tarde («después de las 5» = 17:00) y de 8 a
 * 11 se queda como está (ambiguo: no limita de más).
 */
const hmFrom = (h: string, m: string | undefined, ampm: string | undefined, word: string | undefined, plusMin = 0, strict = false): string | null => {
  let hour = Number(h);
  const min = Number(m ?? 0);
  if (!Number.isFinite(hour) || hour > 23 || min > 59) return null;
  const suffix = (ampm ?? "").replace(/[^ap]/g, "") || (word === "manana" ? "a" : word ? "p" : "");
  // «antes de las 9» sin a. m./p. m. es ambiguo: un tope duro de más no se pone.
  if (strict && !suffix && hour >= 8 && hour <= 11) return null;
  if (suffix === "p" && hour < 12) hour += 12;
  else if (suffix === "a" && hour === 12) hour = 0;
  else if (!suffix && hour >= 1 && hour <= 7) hour += 12;
  const total = Math.min(hour * 60 + min + plusMin, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
/** Las 4 partes de `TIME` desde el grupo `i` de una coincidencia. */
const timeAt = (m: RegExpMatchArray, i: number, plusMin = 0, strict = false) => hmFrom(m[i]!, m[i + 1], m[i + 2], m[i + 3], plusMin, strict);

// «mi trabajo va desde 7 am a 4 pm» (la hora del final; media hora para llegar).
const WORK_RANGE = new RegExp(
  String.raw`\b(trabajo|trabajar|laboro|jornada|turno)\b[^.!?\n]{0,30}?\b(?:de|desde)\s+(?:las\s+)?${TIME}\s*(?:a|hasta|-)\s*(?:las\s+)?${TIME}`
);
// «salgo a las 6» (no «sale»: «sale, a las 3 me queda bien»).
const LEAVE_AT = new RegExp(String.raw`\b(salgo|salimos|termino|me desocupo|desocupo)\b[^.!?\n]{0,25}?\b(?:a|como a|desde)\s+las?\s+${TIME}`);
const FREE_FROM = new RegExp(String.raw`\b(?:estoy libre|quedo libre|libre)\b[^.!?\n]{0,15}?\bdesde\s+las?\s+${TIME}`);
const WORK_UNTIL = new RegExp(String.raw`\b(trabajo|trabajar|laboro|estoy trabajando)\b[^.!?\n]{0,20}?\bhasta\s+las?\s+${TIME}`);
const AFTER = new RegExp(String.raw`\b(?:despues de|a partir de)\s+las?\s+${TIME}`);
const BEFORE = new RegExp(String.raw`\b(?:antes de|hasta)\s+las?\s+${TIME}`);
const NO_MIDDAY = /\bno\s+(puedo|podre|alcanzo|me queda|me sirve)\b[^.!?\n]{0,25}\b(medio\s?dia|mediodia|almuerzo|hora del almuerzo)\b/;
/** Lo de un día en particular («los lunes trabajo de 8 a 12») no vale para todos los días. */
/** «no puedo después de las 5» es un tope (no una hora desde la que sí): se invierte. */
const NEGATED = /\bno\s+(?:puedo|podre|salgo|alcanzo|llego|me queda|me sirve|estoy)\b/;
const A_WEEKDAY = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|fines? de semana)\b/;

export const hourLimitsFrom = (textsNewestFirst: (string | null | undefined)[]): Pick<SlotWish, "fromTime" | "toTime" | "avoidMidday"> => {
  const out: Pick<SlotWish, "fromTime" | "toTime" | "avoidMidday"> = {};
  for (const raw of textsNewestFirst) {
    const t = fold(raw ?? "")
      .replace(/\bbuen[oa]s (tardes|noches|dias)\b/g, " ")
      // «7 p. m.» → «7pm»: el punto no parte la frase.
      .replace(/\b([ap])\.\s?m\b\.?/g, "$1m");
    // La última frase manda.
    for (const s of t.split(/[.!?\n]+/).map((x) => x.trim()).filter(Boolean).reverse()) {
      if (A_WEEKDAY.test(s)) continue;
      if (!out.avoidMidday && NO_MIDDAY.test(s)) out.avoidMidday = true;
      const negated = NEGATED.test(s);
      if (!out.fromTime) {
        const w = s.match(WORK_RANGE);
        // Con «no» (no salgo a las 6, no trabajo hasta las 5, no estoy libre desde las 5) esas
        // frases no dan una hora «desde»: no se leen al derecho (revisión 13-nov).
        const l = w || negated ? null : s.match(LEAVE_AT);
        const u = w || l || negated ? null : s.match(WORK_UNTIL);
        const f = w || l || u || negated ? null : s.match(FREE_FROM);
        const a = w || l || u || f || negated ? null : s.match(AFTER);
        // Al salir del trabajo, media hora para llegar.
        const from = w ? timeAt(w, 6, 30) : l ? timeAt(l, 2, 30) : u ? timeAt(u, 2, 30) : f ? timeAt(f, 1) : a ? timeAt(a, 1) : null;
        if (from) out.fromTime = from;
      }
      // «no puedo después de las 5» → hasta las 5; «no estoy libre desde las 5», igual.
      if (negated && !out.toTime) {
        const a = s.match(AFTER) ?? s.match(FREE_FROM);
        const to = a ? timeAt(a, 1, 0, true) : null;
        if (to) out.toTime = to;
      }
      if (!out.toTime && !WORK_UNTIL.test(s) && !negated) {
        const b = s.match(BEFORE);
        const to = b ? timeAt(b, 1, 0, true) : null;
        if (to) out.toTime = to;
      }
      // «no puedo antes de las 10» / «no salgo hasta las 6» → desde esa hora.
      if (negated && !out.fromTime) {
        const b = s.match(BEFORE);
        const from = b ? timeAt(b, 1) : null;
        if (from) out.fromTime = from;
      }
    }
    if (out.fromTime && out.avoidMidday) break;
  }
  if (out.fromTime && out.toTime && out.toTime <= out.fromTime) delete out.toTime;
  return out;
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
  // Lo que no puede se respeta siempre: días, desde cuándo y sus horas (Carito, 12-nov).
  const keep: SlotWish = {
    notWeekdays: wish.notWeekdays,
    notDates: wish.notDates,
    fromDate: wish.fromDate,
    fromTime: wish.fromTime,
    toTime: wish.toTime,
    avoidMidday: wish.avoidMidday,
  };
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
  config: HoursConfig,
  start: Date,
  durationMin: number,
  timezone: string
): boolean => {
  const dateKey = getDateKeyInTz(start, timezone);
  const startMin = hmToMinutes(getTimeHmInTz(start, timezone));
  return rangesForDate(config, dateKey).some((r) => startMin >= r.from && startMin + durationMin <= r.to);
};

/**
 * Con la llamada agendada, dice que a esa hora no puede o que es a otra hora
 * (Carito, 12 y 13-nov: «no puedo a mediodía por mi trabajo», «Recuerda que es
 * a la 7 pm»): se le buscan horas que le sirvan y, cuando elija, se mueve.
 * Solo un «no puedo» sobre la hora (no «no puedo esperar», «no puedo pagar») o
 * pedir cambiarla. Una hora que repite la que ya tiene («perfecto, es a las 7»)
 * es confirmarla: con `booked` (la hora de su cita en su zona, «19:15») solo
 * cuenta si es otra.
 */
const NO_TIME =
  /\bno\s+(?:puedo|podre|voy a poder|alcanzo|llego|me queda|me sirve|me va bien)\b[^.!?\n]{0,30}?\b(?:a las|a la|a esa hora|esa hora|a ese horario|ese horario|a medio\s?dia|medio\s?dia|a esa|ese dia|hoy)\b/;
const RESCHEDULE =
  /\b(?:cambiar|mover|correr|reagendar|reprogramar)\w{0,3}\b[^.!?\n]{0,25}?\b(?:llamada|cita|hora)\b|\bla\s+(?:puedo|podemos|podria|podriamos|pueden|podrian)\s+(?:cambiar|mover|correr|reagendar|reprogramar)\b|\b(?:otra|otro)\s+(?:hora|dia|horario|fecha)\b|\bse me\s+(?:cruzo|complico)\b|\btengo\s+(?:un\s+)?(?:compromiso|trabajo)\b/;
const OTHER_HOUR = new RegExp(
  String.raw`\b(?:recuerd\w*|ojo)\b[^.!?\n]{0,20}?\b(?:a|para)\s+las?\s+${TIME}|\b(?:es|era)\s+(?:a|para)\s+las?\s+${TIME}`
);
export const saysCantMakeIt = (texts: (string | null | undefined)[], booked?: { hm: string }): boolean =>
  texts.some((raw) => {
    const t = fold(raw ?? "").replace(/\b([ap])\.\s?m\b\.?/g, "$1m");
    if (/\bpag(ar|o|ue)\b/.test(t)) return false;
    if (NO_TIME.test(t) || RESCHEDULE.test(t)) return true;
    const o = t.match(OTHER_HOUR);
    if (!o) return false;
    // Los dos juegos de grupos: «recuerda… a las N» (1–4) o «es a las N» (5–8).
    const i = o[1] !== undefined ? 1 : 5;
    const hasSuffix = Boolean(o[i + 2] || o[i + 3]);
    const n = Number(o[i]);
    const said = timeAt(o, i);
    if (!said) return false;
    // Sin a. m./p. m., la hora puede ser de la mañana o de la tarde: si cualquiera es la de su cita, la confirma.
    const candidates = hasSuffix ? [Number(said.slice(0, 2))] : [n % 24, (n + 12) % 24];
    return !booked || !candidates.includes(Number(booked.hm.slice(0, 2)));
  });
