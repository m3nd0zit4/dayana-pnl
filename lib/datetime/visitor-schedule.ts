/**
 * Friendly Spanish place labels + local clock formatting for visitor / contact TZ.
 * Used by public pages (browser TZ / geo) and emails (Contact.timezone).
 *
 * IMPORTANT: this module must stay free of server-only imports (Prisma, etc.)
 * so client components can hydrate.
 */

import {
  suggestTimezoneForCountry,
  suggestTimezoneForCountryOrNull,
} from "@/lib/contact-timezone";
import { DEFAULT_OPERATIONAL_TZ } from "@/lib/datetime/zoned-time";

const COUNTRY_ES: Record<string, string> = {
  CO: "Colombia",
  MX: "México",
  US: "Estados Unidos",
  CA: "Canadá",
  ES: "España",
  GB: "Reino Unido",
  AR: "Argentina",
  CL: "Chile",
  PE: "Perú",
  EC: "Ecuador",
  VE: "Venezuela",
  BO: "Bolivia",
  PY: "Paraguay",
  UY: "Uruguay",
  BR: "Brasil",
  PA: "Panamá",
  CR: "Costa Rica",
  GT: "Guatemala",
  DO: "República Dominicana",
  PR: "Puerto Rico",
  FR: "Francia",
  DE: "Alemania",
  IT: "Italia",
  PT: "Portugal",
  AU: "Australia",
};

/** Curated IANA → short Spanish phrase shown next to the local clock time. */
const TZ_LABEL_ES: Record<string, string> = {
  "America/Bogota": "hora Colombia",
  "America/Lima": "hora Perú",
  "America/Guayaquil": "hora Ecuador",
  "America/Caracas": "hora Venezuela",
  "America/La_Paz": "hora Bolivia",
  "America/Santiago": "hora Chile",
  "America/Argentina/Buenos_Aires": "hora Argentina",
  "America/Sao_Paulo": "hora Brasil",
  "America/Mexico_City": "hora México",
  "America/Monterrey": "hora México",
  "America/Cancun": "hora Cancún · México",
  "America/Panama": "hora Panamá",
  "America/Costa_Rica": "hora Costa Rica",
  "America/Guatemala": "hora Guatemala",
  "America/Santo_Domingo": "hora República Dominicana",
  "America/Puerto_Rico": "hora Puerto Rico",
  "America/New_York": "hora Este · EE. UU.",
  "America/Detroit": "hora Este · EE. UU.",
  "America/Indiana/Indianapolis": "hora Este · EE. UU.",
  "America/Chicago": "hora Centro · EE. UU.",
  "America/Denver": "hora Montaña · EE. UU.",
  "America/Phoenix": "hora Arizona · EE. UU.",
  "America/Los_Angeles": "hora Pacífico · EE. UU.",
  "America/Anchorage": "hora Alaska · EE. UU.",
  "Pacific/Honolulu": "hora Hawái · EE. UU.",
  "America/Toronto": "hora Este · Canadá",
  "America/Vancouver": "hora Pacífico · Canadá",
  "America/Edmonton": "hora Montaña · Canadá",
  "America/Winnipeg": "hora Centro · Canadá",
  "Europe/Madrid": "hora España",
  "Europe/London": "hora Reino Unido",
  "Europe/Paris": "hora Francia",
  "Europe/Berlin": "hora Alemania",
  "Europe/Rome": "hora Italia",
  "Europe/Lisbon": "hora Portugal",
  "Australia/Sydney": "hora Sídney · Australia",
  "Australia/Melbourne": "hora Melbourne · Australia",
};

const cityFromIana = (timeZone: string): string => {
  const raw = timeZone.split("/").pop() ?? timeZone;
  return raw.replace(/_/g, " ");
};

const regionNameEs = (countryIso: string): string | null => {
  try {
    return (
      new Intl.DisplayNames(["es"], { type: "region" }).of(
        countryIso.toUpperCase()
      ) ?? null
    );
  } catch {
    return null;
  }
};

/** Browser IANA zone, falling back to Bogotá if unavailable. */
export const getVisitorTimeZone = (): string => {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_OPERATIONAL_TZ
    );
  } catch {
    return DEFAULT_OPERATIONAL_TZ;
  }
};

/**
 * Public-page display zone.
 * Prefer Vercel geo country → IANA via `@vvo/tzdb` (all ~247 countries).
 * Only fall back to the browser zone when geo is missing/unknown.
 */
export const resolveVisitorDisplayTimeZone = (
  userCountry?: string | null
): string => {
  const iso = userCountry?.trim().toUpperCase() || null;
  if (iso) {
    const fromGeo = suggestTimezoneForCountryOrNull(iso);
    if (fromGeo) return fromGeo;
  }
  return getVisitorTimeZone();
};

/**
 * Label like "hora Colombia" or "hora Este · EE. UU.".
 * Prefers curated map → Intl region name → Intl longGeneric → city.
 */
export const getSchedulePlaceLabel = (
  timeZone: string,
  countryIso?: string | null
): string => {
  const curated = TZ_LABEL_ES[timeZone];
  if (curated) return curated;

  const iso = countryIso?.toUpperCase() ?? null;
  const countryName =
    (iso ? regionNameEs(iso) : null) ??
    (iso ? (COUNTRY_ES[iso] ?? null) : null);

  try {
    const parts = new Intl.DateTimeFormat("es", {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date());
    const generic = parts.find((p) => p.type === "timeZoneName")?.value?.trim();
    if (generic) {
      if (
        countryName &&
        (iso === "US" || iso === "CA" || iso === "MX" || iso === "AU") &&
        !generic.toLowerCase().includes(countryName.toLowerCase().slice(0, 6))
      ) {
        return `${generic} · ${countryName}`;
      }
      return generic;
    }
  } catch {
    // ignore
  }

  if (countryName) return `hora ${countryName}`;
  return `hora ${cityFromIana(timeZone)}`;
};

/** Local clock time only (12h with a. m. / p. m., no zone abbreviation). */
export const formatLocalClockTime = (
  startsAtIso: string,
  timeZone: string
): string => {
  const d = new Date(startsAtIso);
  return new Intl.DateTimeFormat("es", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(d);
};

/** Local long date for the calendar chip. */
export const formatLocalLongDate = (
  startsAtIso: string,
  timeZone: string
): string => {
  const d = new Date(startsAtIso);
  return new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(d);
};

/** Compact medium date + short 12h time in a given IANA zone. */
export const formatLocalDateTimeMedium = (
  startsAtIso: string,
  timeZone: string
): string => {
  const d = new Date(startsAtIso);
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
    timeZone,
  }).format(d);
};

/**
 * Resolve which IANA zone to use for a contact (emails / WhatsApp).
 * Prefer stored timezone → phone country → CRM default.
 */
export const resolveContactTimeZone = (input: {
  timezone?: string | null;
  countryIso?: string | null;
  fallbackTz?: string;
}): string => {
  const tz = input.timezone?.trim();
  if (tz) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      return tz;
    } catch {
      /* invalid */
    }
  }
  if (input.countryIso) {
    return suggestTimezoneForCountry(input.countryIso);
  }
  return input.fallbackTz ?? DEFAULT_OPERATIONAL_TZ;
};

export type InstantForContact = {
  date: string;
  time: string;
  dateTime: string;
  place: string;
  timeZone: string;
  /** e.g. "19:30 · hora España" */
  timeWithPlace: string;
};

/** Format an UTC instant for a contact (server-side emails / Inngest). */
export const formatInstantForContact = (
  startsAtIso: string | Date,
  opts: {
    timezone?: string | null;
    countryIso?: string | null;
    fallbackTz?: string;
  } = {}
): InstantForContact => {
  const iso =
    typeof startsAtIso === "string" ? startsAtIso : startsAtIso.toISOString();
  const timeZone = resolveContactTimeZone(opts);
  const date = formatLocalLongDate(iso, timeZone);
  const time = formatLocalClockTime(iso, timeZone);
  const place = getSchedulePlaceLabel(timeZone, opts.countryIso);
  return {
    date,
    time,
    dateTime: formatLocalDateTimeMedium(iso, timeZone),
    place,
    timeZone,
    timeWithPlace: `${time} · ${place}`,
  };
};
