/**
 * Friendly Spanish place label for the visitor's timezone, so the webinar
 * clock chip never shows an ambiguous abbreviation like "GMT-5".
 */

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

/** Browser IANA zone, falling back to Bogotá if unavailable. */
export const getVisitorTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota";
  } catch {
    return "America/Bogota";
  }
};

/**
 * Label like "hora Colombia" or "hora Este · EE. UU.".
 * Prefers curated map → Intl longGeneric → city + country.
 */
export const getSchedulePlaceLabel = (
  timeZone: string,
  countryIso?: string | null
): string => {
  const curated = TZ_LABEL_ES[timeZone];
  if (curated) return curated;

  const iso = countryIso?.toUpperCase() ?? null;
  const countryName = iso ? COUNTRY_ES[iso] ?? null : null;

  try {
    const parts = new Intl.DateTimeFormat("es", {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date());
    const generic = parts.find((p) => p.type === "timeZoneName")?.value?.trim();
    if (generic) {
      // "hora del Este" alone is ambiguous — append country for multi-zone nations.
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
    // ignore — fall through
  }

  if (countryName) return `hora ${countryName}`;
  return `hora ${cityFromIana(timeZone)}`;
};

/** Local clock time only (no zone abbreviation). */
export const formatLocalClockTime = (
  startsAtIso: string,
  timeZone: string
): string => {
  const d = new Date(startsAtIso);
  return new Intl.DateTimeFormat("es", {
    hour: "numeric",
    minute: "2-digit",
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
