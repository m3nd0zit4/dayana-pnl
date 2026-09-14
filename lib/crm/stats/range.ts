import {
  DEFAULT_OPERATIONAL_TZ,
  getDateKeyInTz,
  isValidIanaTimeZone,
} from "@/lib/datetime/zoned-time";

import type { StatsArea, StatsGranularity, StatsPeriod, StatsRange } from "./types";

export const STATS_PERIODS: readonly StatsPeriod[] = ["7d", "30d", "90d", "12mo", "custom"];

export const DEFAULT_STATS_PERIOD = "30d" satisfies StatsPeriod;

export const STATS_AREAS: readonly StatsArea[] = ["ventas", "embudo", "contactos", "contenido"];

export const DEFAULT_STATS_AREA = "ventas" satisfies StatsArea;

/**
 * Días calendario locales por preset, incluyendo hoy. `12mo` son 365 días
 * (no "mismo día del año anterior"): así el periodo anterior tiene siempre la
 * misma longitud y la comparación no depende de si cruza un 29 de febrero.
 */
const PRESET_DAYS: Record<Exclude<StatsPeriod, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12mo": 365,
};

/** Tope de un rango personalizado (un año bisiesto completo). */
const MAX_CUSTOM_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function parseStatsArea(value: string | string[] | undefined): StatsArea {
  const raw = first(value);
  return (STATS_AREAS as readonly string[]).includes(raw ?? "")
    ? (raw as StatsArea)
    : DEFAULT_STATS_AREA;
}

/**
 * Milisegundos UTC de la medianoche *UTC* de una fecha "YYYY-MM-DD", o null
 * si el formato o la fecha no son reales (p. ej. 2026-02-30). Se usa solo como
 * aritmética de calendario: sumar días a esta cifra nunca sufre DST.
 */
const parseDateKeyUtc = (key: string): number | null => {
  const match = DATE_KEY_RE.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
};

const requireDateKeyUtc = (key: string): number => {
  const ms = parseDateKeyUtc(key);
  if (ms === null) throw new Error(`INVALID_DATE_KEY: ${key}`);
  return ms;
};

const utcMsToKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const addDaysToKey = (key: string, days: number): string =>
  utcMsToKey(requireDateKeyUtc(key) + days * DAY_MS);

/** Días entre dos fechas calendario (b − a). */
const diffDays = (a: string, b: string): number =>
  Math.round((requireDateKeyUtc(b) - requireDateKeyUtc(a)) / DAY_MS);

/** Desfase (local − UTC) en ms de `timeZone` en un instante dado. */
const offsetMsAt = (instantMs: number, timeZone: string): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(instantMs))
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  // El formateador trunca a segundos; se compara contra el instante truncado.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
};

/**
 * Primer instante (UTC) del día calendario `key` en `timeZone`.
 *
 * No se usa `getStartOfDayInTz` de zoned-time: toma el desfase del mediodía y
 * falla en días de cambio de hora cuyo cambio ocurre después de medianoche
 * (Europe/Madrid 2026-10-25 devuelve 23:00Z en vez de 22:00Z). Aquí se prueban
 * los desfases vigentes alrededor del día y se queda el instante más temprano
 * que cae en ese día local; así también funciona cuando la medianoche no
 * existe (zonas que adelantan la hora a las 00:00, p. ej. America/Santiago).
 */
const startOfLocalDayMs = (key: string, timeZone: string): number => {
  const base = requireDateKeyUtc(key);
  const offsets = new Set([
    offsetMsAt(base - DAY_MS, timeZone),
    offsetMsAt(base, timeZone),
    offsetMsAt(base + DAY_MS, timeZone),
  ]);
  let best: number | null = null;
  for (const offset of offsets) {
    const candidate = base - offset;
    if (getDateKeyInTz(new Date(candidate), timeZone) !== key) continue;
    if (best === null || candidate < best) best = candidate;
  }
  if (best !== null) return best;
  // Inalcanzable con zonas IANA reales; se deja un valor razonable por si acaso.
  return base - offsetMsAt(base, timeZone);
};

const granularityForDays = (days: number): StatsGranularity => {
  // Umbrales tomados de Dub: hasta ~1,5 meses por día, hasta ~6 meses por semana.
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
};

const buildRange = (
  period: StatsPeriod,
  fromKey: string,
  toKey: string,
  timeZone: string
): StatsRange => {
  const days = diffDays(fromKey, toKey) + 1;
  const from = new Date(startOfLocalDayMs(fromKey, timeZone));
  const to = new Date(startOfLocalDayMs(addDaysToKey(toKey, 1), timeZone));
  const prevFrom = new Date(startOfLocalDayMs(addDaysToKey(fromKey, -days), timeZone));
  return {
    period,
    timeZone,
    from,
    to,
    prevFrom,
    prevTo: from,
    fromKey,
    toKey,
    granularity: granularityForDays(days),
    days,
  };
};

/**
 * Traduce los searchParams de la página (`?period=&from=&to=`) a un rango de
 * instantes UTC alineado a días locales de la zona operativa.
 *
 * Todo se calcula con claves de fecha locales y aritmética de calendario, nunca
 * sumando múltiplos de 24 h a un instante: en zonas con DST hay días de 23 h y
 * de 25 h, y `from`/`to` deben ser siempre medianoches locales.
 *
 * Reglas de `custom` (decisiones documentadas):
 * - `from` y `to` son obligatorios y deben ser fechas reales "YYYY-MM-DD";
 *   si falta o falla alguno se usa el preset por defecto.
 * - Si vienen invertidos se intercambian.
 * - `to` se recorta a hoy; si `from` también queda en el futuro, el rango se
 *   reduce a hoy.
 * - Más de 366 días: se recorta `from` (se conserva el final elegido).
 */
export function parseStatsRange(
  params: { period?: string | string[]; from?: string | string[]; to?: string | string[] },
  timeZone: string,
  now: Date = new Date()
): StatsRange {
  const tz = isValidIanaTimeZone(timeZone) ? timeZone : DEFAULT_OPERATIONAL_TZ;
  const todayKey = getDateKeyInTz(now, tz);

  const rawPeriod = first(params.period);
  const period: StatsPeriod = (STATS_PERIODS as readonly string[]).includes(rawPeriod ?? "")
    ? (rawPeriod as StatsPeriod)
    : DEFAULT_STATS_PERIOD;

  if (period === "custom") {
    const rawFrom = first(params.from)?.trim();
    const rawTo = first(params.to)?.trim();
    if (
      rawFrom !== undefined &&
      rawTo !== undefined &&
      parseDateKeyUtc(rawFrom) !== null &&
      parseDateKeyUtc(rawTo) !== null
    ) {
      let fromKey = rawFrom;
      let toKey = rawTo;
      if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
      if (toKey > todayKey) toKey = todayKey;
      if (fromKey > toKey) fromKey = toKey;
      if (diffDays(fromKey, toKey) + 1 > MAX_CUSTOM_DAYS) {
        fromKey = addDaysToKey(toKey, -(MAX_CUSTOM_DAYS - 1));
      }
      return buildRange("custom", fromKey, toKey, tz);
    }
    const days = PRESET_DAYS[DEFAULT_STATS_PERIOD];
    return buildRange(DEFAULT_STATS_PERIOD, addDaysToKey(todayKey, -(days - 1)), todayKey, tz);
  }

  const days = PRESET_DAYS[period];
  return buildRange(period, addDaysToKey(todayKey, -(days - 1)), todayKey, tz);
}

/** Lunes (semana ISO) en o antes de la fecha dada, como "YYYY-MM-DD". */
const mondayOnOrBefore = (dateKey: string): string => {
  const ms = requireDateKeyUtc(dateKey);
  const weekday = new Date(ms).getUTCDay(); // 0 = domingo
  const back = (weekday + 6) % 7;
  return utcMsToKey(ms - back * DAY_MS);
};

/**
 * Clave de cubeta para una fecha local: el propio día, el lunes de su semana
 * ISO ("YYYY-MM-DD") o el mes ("YYYY-MM"). Las claves ordenan
 * lexicográficamente igual que cronológicamente. Lanza si `dateKey` no es una
 * fecha real: una clave mal formada desde SQL es un bug, no un dato.
 */
export function bucketKeyForDateKey(dateKey: string, granularity: StatsGranularity): string {
  const key = dateKey.trim();
  requireDateKeyUtc(key);
  if (granularity === "day") return key;
  if (granularity === "week") return mondayOnOrBefore(key);
  return key.slice(0, 7);
}

/** Claves de cubeta ordenadas que cubren el rango completo (sin huecos). */
export function bucketKeys(range: StatsRange): string[] {
  const { fromKey, toKey, granularity } = range;
  const keys: string[] = [];
  if (granularity === "day") {
    for (let key = fromKey; key <= toKey; key = addDaysToKey(key, 1)) keys.push(key);
    return keys;
  }
  if (granularity === "week") {
    for (let key = mondayOnOrBefore(fromKey); key <= toKey; key = addDaysToKey(key, 7)) {
      keys.push(key);
    }
    return keys;
  }
  let year = Number(fromKey.slice(0, 4));
  let month = Number(fromKey.slice(5, 7));
  const last = toKey.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

/** SearchParams canónicos del rango (para enlaces y el selector de periodo). */
export function statsRangeToSearchParams(
  range: Pick<StatsRange, "period" | "fromKey" | "toKey">
): Record<string, string> {
  if (range.period === "custom") {
    return { period: "custom", from: range.fromKey, to: range.toKey };
  }
  return { period: range.period };
}
