import { parsePhoneNumberFromString } from "libphonenumber-js";

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

/** Ciudades grandes de los países con varias zonas: con eso ya se sabe la hora. */
const CITY_ZONES: { re: RegExp; iso: string; city: string; timezone: string }[] = [
  { re: /\b(cdmx|ciudad de mexico|df|edomex|estado de mexico|guadalajara|monterrey|puebla|queretaro|toluca|morelia|leon guanajuato)\b/, iso: "MX", city: "Ciudad de México", timezone: "America/Mexico_City" },
  { re: /\b(cancun|quintana roo|playa del carmen)\b/, iso: "MX", city: "Cancún", timezone: "America/Cancun" },
  { re: /\b(tijuana|mexicali|baja california)\b/, iso: "MX", city: "Tijuana", timezone: "America/Tijuana" },
  { re: /\b(miami|orlando|florida|nueva york|new york|new jersey|boston|atlanta)\b/, iso: "US", city: "Miami", timezone: "America/New_York" },
  { re: /\b(houston|dallas|texas|chicago)\b/, iso: "US", city: "Houston", timezone: "America/Chicago" },
  { re: /\b(los angeles|california|las vegas|seattle)\b/, iso: "US", city: "Los Ángeles", timezone: "America/Los_Angeles" },
];

/** Países que la persona nombra («desde colombia», «vivo en españa»). */
const COUNTRY_WORDS: { re: RegExp; iso: string }[] = [
  { re: /\bcolombia\b/, iso: "CO" },
  { re: /\bperu\b/, iso: "PE" },
  { re: /\becuador\b/, iso: "EC" },
  { re: /\bvenezuela\b/, iso: "VE" },
  { re: /\bpanama\b/, iso: "PA" },
  { re: /\bcosta rica\b/, iso: "CR" },
  { re: /\bguatemala\b/, iso: "GT" },
  { re: /\bbolivia\b/, iso: "BO" },
  { re: /\buruguay\b/, iso: "UY" },
  { re: /\bparaguay\b/, iso: "PY" },
  { re: /\b(republica dominicana|dominicana)\b/, iso: "DO" },
  { re: /\bel salvador\b/, iso: "SV" },
  { re: /\bhonduras\b/, iso: "HN" },
  { re: /\bnicaragua\b/, iso: "NI" },
  { re: /\bpuerto rico\b/, iso: "PR" },
  { re: /\bespana\b/, iso: "ES" },
  { re: /\bargentina\b/, iso: "AR" },
  { re: /\bchile\b/, iso: "CL" },
  { re: /\bmexico\b/, iso: "MX" },
  { re: /\b(estados unidos|usa|eeuu)\b/, iso: "US" },
];

/** Países con varias zonas cuya zona principal sirve sin preguntar la ciudad. */
const MAIN_ZONE_OK = new Set(["ES", "AR", "CL"]);

/**
 * La zona de la persona cuando la IA no la guardó: la ciudad o el país que
 * dijo en el chat, o el país de su número si tiene una sola zona (Colombia,
 * Perú, Ecuador…). `null` si no alcanza (México sin ciudad, por ejemplo).
 * Sophie y «💙💙💜🩷», 16-oct: dijeron «Desde colombia» y «De la CDMX», la IA
 * no llamó a `save_country`, la agenda falló y ella inventó horas.
 */
export const inferPersonZone = (
  phone: string,
  transcript: { direction: "INBOUND" | "OUTBOUND"; body: string | null }[]
): { iso: string; city: string | null; timezone: string } | null => {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const said = fold(
    transcript
      .filter((l) => l.direction === "INBOUND")
      .map((l) => l.body ?? "")
      .join(" \n ")
  );
  const city = CITY_ZONES.find((c) => c.re.test(said));
  if (city) return { iso: city.iso, city: city.city, timezone: city.timezone };
  const named = COUNTRY_WORDS.find((c) => c.re.test(said))?.iso ?? null;
  // El país del número tal cual (inferLocaleFromPhone devuelve el país de respaldo para todo).
  const fromPhone = /^\d{7,15}$/.test(phone) ? (parsePhoneNumberFromString(`+${phone}`)?.country ?? null) : null;
  const iso = named ?? fromPhone;
  if (!iso) return null;
  if (MULTI_ZONE_COUNTRIES.has(iso) && !MAIN_ZONE_OK.has(iso)) return null;
  const timezone = suggestTimezoneForCountryOrNull(iso);
  return timezone ? { iso, city: null, timezone } : null;
};
