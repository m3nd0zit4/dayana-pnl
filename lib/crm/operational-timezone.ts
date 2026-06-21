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
    Number(parts.hour),
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
