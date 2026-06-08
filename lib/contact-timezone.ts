import type { CountryCode } from "libphonenumber-js";
import { normalizePhoneWithCountry } from "./phone";

/** Zonas IANA habituales por país (una por país; editable en el formulario). */
const TZ_BY_COUNTRY: Partial<Record<CountryCode, string>> = {
  CO: "America/Bogota",
  MX: "America/Mexico_City",
  US: "America/New_York",
  CA: "America/Toronto",
  ES: "Europe/Madrid",
  GB: "Europe/London",
  AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago",
  PE: "America/Lima",
  EC: "America/Guayaquil",
  VE: "America/Caracas",
  BO: "America/La_Paz",
  PY: "America/Asuncion",
  UY: "America/Montevideo",
  BR: "America/Sao_Paulo",
  PA: "America/Panama",
  CR: "America/Costa_Rica",
  GT: "America/Guatemala",
  HN: "America/Tegucigalpa",
  SV: "America/El_Salvador",
  NI: "America/Managua",
  DO: "America/Santo_Domingo",
  PR: "America/Puerto_Rico",
  CU: "America/Havana",
  JM: "America/Jamaica",
  PT: "Europe/Lisbon",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  CH: "Europe/Zurich",
  AT: "Europe/Vienna",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  PL: "Europe/Warsaw",
  GR: "Europe/Athens",
  TR: "Europe/Istanbul",
  RU: "Europe/Moscow",
  UA: "Europe/Kyiv",
  IL: "Asia/Jerusalem",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  IN: "Asia/Kolkata",
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  SG: "Asia/Singapore",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  PH: "Asia/Manila",
  ID: "Asia/Jakarta",
  MY: "Asia/Kuala_Lumpur",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  ZA: "Africa/Johannesburg",
  EG: "Africa/Cairo",
  NG: "Africa/Lagos",
  KE: "Africa/Nairobi",
  MA: "Africa/Casablanca",
};

export const suggestTimezoneForCountry = (iso2: string): string =>
  TZ_BY_COUNTRY[iso2 as CountryCode] ?? "America/Bogota";

export type InferredContactLocale = {
  phoneE164: string;
  phoneCountry: string;
  countryIso: string;
  timezone: string;
};

/** Infiere país y zona horaria desde el número (con o sin +). */
export const inferLocaleFromPhone = (
  raw: string,
  fallbackCountry: string
): InferredContactLocale | null => {
  const fallback = (fallbackCountry || "CO") as CountryCode;
  const normalized = normalizePhoneWithCountry(raw, fallback);
  if (!normalized) return null;

  const iso = normalized.phoneCountryIso;
  return {
    phoneE164: normalized.phoneE164,
    phoneCountry: iso,
    countryIso: iso,
    timezone: suggestTimezoneForCountry(iso),
  };
};
