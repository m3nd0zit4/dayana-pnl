/**
 * Pure IANA timezone helpers — safe for client components.
 * DB-backed CRM timezone lives in `lib/crm/operational-timezone.ts`.
 */

/** Fallback when no SiteSetting row exists / browser TZ unavailable. */
export const DEFAULT_OPERATIONAL_TZ = "America/Bogota";

/**
 * Sync default for call sites that cannot await.
 * Prefer `getOperationalTimezone()` when persisting or displaying CRM times.
 */
export const OPERATIONAL_TZ = DEFAULT_OPERATIONAL_TZ;

export const isValidIanaTimeZone = (tz: string): boolean => {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const getOffsetMs = (at: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - at.getTime();
};

/** Fecha calendario YYYY-MM-DD en la zona indicada. */
export const getDateKeyInTz = (
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TZ
): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Hora HH:mm (24h) en la zona indicada. */
export const getTimeHmInTz = (
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TZ
): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${hour}:${parts.minute}`;
};

/**
 * Convierte fecha calendario + hora local (zona dada) a instante UTC.
 * `dateKey` = YYYY-MM-DD, `timeHm` = HH:mm or HH:mm:ss.
 */
export const zonedDateTimeToUtc = (
  dateKey: string,
  timeHm: string,
  timeZone: string = DEFAULT_OPERATIONAL_TZ
): Date => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeHm.trim());
  if (!dateMatch || !timeMatch) {
    throw new Error("INVALID_ZONED_DATETIME");
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error("INVALID_ZONED_DATETIME");
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offsetMs);
};

/** Medianoche del día calendario (en `timeZone`) como instante UTC. */
export const getStartOfDayInTz = (
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TZ
): Date => {
  const key = getDateKeyInTz(date, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offsetMs = getOffsetMs(new Date(noonUtc), timeZone);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
};

/** Inicio del día siguiente (exclusivo para rangos `gte` / `lt`). */
export const getStartOfNextDayInTz = (
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TZ
): Date => {
  const start = getStartOfDayInTz(date, timeZone);
  const probe = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  return getStartOfDayInTz(probe, timeZone);
};

/** Normalize `HH:mm` / `HH:mm:ss` → `HH:mm` for storage / comparisons. */
export const normalizeTimeHm = (time: string): string | null => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
