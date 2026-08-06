import type { CountryCode } from "libphonenumber-js";
import { getTimeZones } from "@vvo/tzdb";
import { normalizePhoneWithCountry } from "./phone";
import { DEFAULT_OPERATIONAL_TZ } from "@/lib/datetime/zoned-time";

/**
 * Explicit primaries for countries with several civil zones (or where the
 * automatic scorer would pick an overseas/outlier zone). Everyone else is
 * resolved from `@vvo/tzdb` (≈247 ISO countries).
 */
const PRIMARY_OVERRIDES: Partial<Record<string, string>> = {
  CO: "America/Bogota",
  MX: "America/Mexico_City",
  US: "America/New_York",
  CA: "America/Toronto",
  ES: "Europe/Madrid",
  GB: "Europe/London",
  UK: "Europe/London",
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
  MN: "Asia/Ulaanbaatar",
  KZ: "Asia/Almaty",
  CD: "Africa/Kinshasa",
};

type TzEntry = ReturnType<typeof getTimeZones>[number];

let zonesByCountryCache: Map<string, TzEntry[]> | null = null;

const zonesByCountry = (): Map<string, TzEntry[]> => {
  if (zonesByCountryCache) return zonesByCountryCache;
  const map = new Map<string, TzEntry[]>();
  for (const tz of getTimeZones()) {
    const code = tz.countryCode?.toUpperCase();
    if (!code) continue;
    const list = map.get(code);
    if (list) list.push(tz);
    else map.set(code, [tz]);
  }
  zonesByCountryCache = map;
  return map;
};

/** Score multi-zone countries when no explicit override exists. */
const scoreZone = (tz: TzEntry): number => {
  let score = tz.mainCities.length;
  if (/^(Atlantic|Pacific|Indian)\//.test(tz.name)) score -= 8;
  if (/^(America|Europe|Asia|Africa|Australia)\//.test(tz.name)) score += 5;
  return score;
};

const pickFromTzdb = (iso: string): string | null => {
  const zones = zonesByCountry().get(iso);
  if (!zones?.length) return null;
  if (zones.length === 1) return zones[0]!.name;

  const ranked = [...zones].sort((a, b) => {
    const diff = scoreZone(b) - scoreZone(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
  return ranked[0]?.name ?? null;
};

/**
 * Best IANA zone for an ISO-3166-1 alpha-2 country.
 * Covers every country in `@vvo/tzdb` (≈247). Returns `null` only if the
 * code is unknown — callers should fall back to the browser zone, **not**
 * hardcode Bogotá (that made far-away VPN visitors see Colombia time).
 */
export const suggestTimezoneForCountry = (
  iso2: string
): string => {
  const iso = iso2.trim().toUpperCase();
  if (!iso || iso === "XX" || iso === "T1") {
    return DEFAULT_OPERATIONAL_TZ;
  }

  const override = PRIMARY_OVERRIDES[iso];
  if (override) return override;

  const fromDb = pickFromTzdb(iso);
  if (fromDb) return fromDb;

  return DEFAULT_OPERATIONAL_TZ;
};

/** Like `suggestTimezoneForCountry` but `null` when the ISO is unrecognized. */
export const suggestTimezoneForCountryOrNull = (
  iso2: string
): string | null => {
  const iso = iso2.trim().toUpperCase();
  if (!iso || iso === "XX" || iso === "T1") return null;
  if (PRIMARY_OVERRIDES[iso]) return PRIMARY_OVERRIDES[iso]!;
  return pickFromTzdb(iso);
};

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
