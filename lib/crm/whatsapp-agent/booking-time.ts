import { suggestTimezoneForCountryOrNull } from "@/lib/contact-timezone";
import { DEFAULT_OPERATIONAL_TZ, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";

/** Países con varias zonas horarias: además del país hay que saber la ciudad. */
export const MULTI_ZONE_COUNTRIES = new Set(["MX", "US", "BR", "CA", "ES", "AR", "CL", "RU", "AU"]);

/** ¿Es una zona IANA que el sistema conoce? */
export const isValidTimezone = (tz: string | null | undefined): tz is string => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("es-CO", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** La zona de la persona: la que dijo la IA (ciudad) o la principal del país. */
export const resolvePersonTimezone = (countryIso: string, timezone?: string | null): string | null =>
  isValidTimezone(timezone) ? timezone : suggestTimezoneForCountryOrNull(countryIso);

export const countryName = (countryIso: string): string => {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(countryIso.toUpperCase()) ?? countryIso;
  } catch {
    return countryIso;
  }
};

const fmt = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);

/**
 * La hora que pidió la persona, en su hora y en la de Colombia (la de Dayana).
 * `localDateTime`: «YYYY-MM-DDTHH:mm» en la hora de la persona.
 */
export const describeRequestedTime = (input: {
  localDateTime: string;
  personTz: string;
  place: string;
  dayanaTz?: string;
}): { utc: Date; text: string } | null => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(input.localDateTime.trim());
  if (!m || !isValidTimezone(input.personTz)) return null;
  const utc = zonedDateTimeToUtc(m[1], m[2], input.personTz);
  if (Number.isNaN(utc.getTime())) return null;
  const dayanaTz = input.dayanaTz ?? DEFAULT_OPERATIONAL_TZ;
  const local = fmt(utc, input.personTz);
  if (input.personTz === dayanaTz) return { utc, text: `${local} (hora de Colombia)` };
  return { utc, text: `${local} hora de ${input.place} = ${fmt(utc, dayanaTz)} en Colombia` };
};
