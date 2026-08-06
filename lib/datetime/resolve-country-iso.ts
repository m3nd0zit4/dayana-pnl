import { getTimeZones } from "@vvo/tzdb";

/** Common Spanish/English aliases → ISO-3166-1 alpha-2. */
const COUNTRY_ALIASES: Record<string, string> = {
  colombia: "CO",
  japón: "JP",
  japon: "JP",
  japan: "JP",
  españa: "ES",
  espana: "ES",
  spain: "ES",
  méxico: "MX",
  mexico: "MX",
  "estados unidos": "US",
  eeuu: "US",
  "ee. uu.": "US",
  usa: "US",
  "united states": "US",
  argentina: "AR",
  chile: "CL",
  perú: "PE",
  peru: "PE",
  ecuador: "EC",
  venezuela: "VE",
  bolivia: "BO",
  paraguay: "PY",
  uruguay: "UY",
  brasil: "BR",
  brazil: "BR",
  panamá: "PA",
  panama: "PA",
  "costa rica": "CR",
  guatemala: "GT",
  honduras: "HN",
  "el salvador": "SV",
  nicaragua: "NI",
  "república dominicana": "DO",
  "republica dominicana": "DO",
  "puerto rico": "PR",
  cuba: "CU",
  jamaica: "JM",
  portugal: "PT",
  francia: "FR",
  france: "FR",
  alemania: "DE",
  germany: "DE",
  italia: "IT",
  italy: "IT",
  "reino unido": "GB",
  "united kingdom": "GB",
  uk: "GB",
  inglaterra: "GB",
  canada: "CA",
  canadá: "CA",
  australia: "AU",
  "nueva zelanda": "NZ",
  "new zealand": "NZ",
  india: "IN",
  china: "CN",
  "hong kong": "HK",
  singapur: "SG",
  singapore: "SG",
  "corea del sur": "KR",
  "south korea": "KR",
  tailandia: "TH",
  thailand: "TH",
  vietnam: "VN",
  filipinas: "PH",
  philippines: "PH",
  indonesia: "ID",
  malasia: "MY",
  malaysia: "MY",
  "emiratos árabes": "AE",
  "emiratos arabes": "AE",
  dubai: "AE",
  "arabia saudita": "SA",
  "saudi arabia": "SA",
  israel: "IL",
  turquía: "TR",
  turkey: "TR",
  rusia: "RU",
  russia: "RU",
  ucrania: "UA",
  ukraine: "UA",
  "sudáfrica": "ZA",
  "sudafrica": "ZA",
  "south africa": "ZA",
  egipto: "EG",
  egypt: "EG",
  nigeria: "NG",
  kenia: "KE",
  kenya: "KE",
  marruecos: "MA",
  morocco: "MA",
  islandia: "IS",
  iceland: "IS",
  finlandia: "FI",
  finland: "FI",
  suecia: "SE",
  sweden: "SE",
  noruega: "NO",
  norway: "NO",
  dinamarca: "DK",
  denmark: "DK",
  polonia: "PL",
  poland: "PL",
  grecia: "GR",
  greece: "GR",
  suiza: "CH",
  switzerland: "CH",
  "países bajos": "NL",
  "paises bajos": "NL",
  netherlands: "NL",
  holanda: "NL",
  bélgica: "BE",
  belgica: "BE",
  belgium: "BE",
  austria: "AT",
  irlanda: "IE",
  ireland: "IE",
};

const normalizeKey = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");

let displayNameIndex: Map<string, string> | null = null;

/** Build ISO lookup from Spanish + English region display names (tzdb countries). */
const getDisplayNameIndex = (): Map<string, string> => {
  if (displayNameIndex) return displayNameIndex;
  const map = new Map<string, string>();
  const codes = new Set(
    getTimeZones()
      .map((z) => z.countryCode?.toUpperCase())
      .filter((c): c is string => Boolean(c))
  );
  for (const locale of ["es", "en"] as const) {
    let dn: Intl.DisplayNames;
    try {
      dn = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      continue;
    }
    for (const code of codes) {
      try {
        const name = dn.of(code);
        if (name) map.set(normalizeKey(name), code);
      } catch {
        /* ignore */
      }
    }
  }
  displayNameIndex = map;
  return map;
};

/**
 * Resolve a free-text country ("Japón", "Spain", "JP") to ISO-3166-1 alpha-2.
 */
export const resolveCountryIso = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();

  const key = normalizeKey(trimmed);
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key]!;

  const fromDisplay = getDisplayNameIndex().get(key);
  if (fromDisplay) return fromDisplay;

  // Partial contains match for longer names
  for (const [alias, iso] of Object.entries(COUNTRY_ALIASES)) {
    if (alias.includes(key) || key.includes(alias)) return iso;
  }

  return null;
};
