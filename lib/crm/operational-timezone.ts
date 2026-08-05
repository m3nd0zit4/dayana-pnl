/** Zona horaria operativa del negocio (Colombia, sin DST). */
export const OPERATIONAL_TZ = "America/Bogota";

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
  timeZone: string = OPERATIONAL_TZ
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
  timeZone: string = OPERATIONAL_TZ
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
 * Convierte fecha calendario + hora local (zona operativa) a instante UTC.
 * `dateKey` = YYYY-MM-DD, `timeHm` = HH:mm.
 */
export const zonedDateTimeToUtc = (
  dateKey: string,
  timeHm: string,
  timeZone: string = OPERATIONAL_TZ
): Date => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeHm.trim());
  if (!dateMatch || !timeMatch) {
    throw new Error("INVALID_ZONED_DATETIME");
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    throw new Error("INVALID_ZONED_DATETIME");
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = getOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offsetMs);
};

/** Medianoche del día calendario (en `timeZone`) como instante UTC. */
export const getStartOfDayInTz = (
  date: Date,
  timeZone: string = OPERATIONAL_TZ
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
  timeZone: string = OPERATIONAL_TZ
): Date => {
  const start = getStartOfDayInTz(date, timeZone);
  const probe = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  return getStartOfDayInTz(probe, timeZone);
};
