/**
 * Lo que cobra Meta por cada plantilla entregada, según el país de la persona
 * y la categoría de la plantilla. Sin base de datos ni red (para probarlo).
 *
 * El texto libre dentro de las 24 h es gratis, y una plantilla de UTILITY
 * dentro de una ventana abierta también. Un envío masivo solo usa plantilla
 * fuera de las 24 h, así que aquí se cobra cada plantilla.
 *
 * Tarifas aproximadas en USD (la tabla pública de Meta; cambia de vez en
 * cuando). Si en Plantillas se puso un precio a mano, manda ese.
 */

export type RateCategory = "MARKETING" | "UTILITY";

export type RateGroup = {
  key: string;
  label: string;
  /** Prefijos del número (sin «+»). Gana el más largo. */
  prefixes: string[];
  MARKETING: number;
  UTILITY: number;
};

export const RATE_CURRENCY = "USD";

export const OTHER_RATE_GROUP: RateGroup = {
  key: "otros",
  label: "Otros",
  prefixes: [],
  MARKETING: 0.0604,
  UTILITY: 0.0077,
};

export const RATE_GROUPS: RateGroup[] = [
  { key: "co", label: "Colombia", prefixes: ["57"], MARKETING: 0.0125, UTILITY: 0.0008 },
  { key: "mx", label: "México", prefixes: ["52"], MARKETING: 0.0436, UTILITY: 0.0085 },
  { key: "ar", label: "Argentina", prefixes: ["54"], MARKETING: 0.0618, UTILITY: 0.026 },
  { key: "br", label: "Brasil", prefixes: ["55"], MARKETING: 0.0625, UTILITY: 0.0068 },
  { key: "cl", label: "Chile", prefixes: ["56"], MARKETING: 0.0889, UTILITY: 0.02 },
  { key: "pe", label: "Perú", prefixes: ["51"], MARKETING: 0.0703, UTILITY: 0.02 },
  {
    key: "latam",
    label: "Resto de Latinoamérica",
    prefixes: ["593", "58", "591", "507", "506", "502", "503", "504", "505", "595", "598", "509"],
    MARKETING: 0.074,
    UTILITY: 0.0113,
  },
  // Todo el +1: Estados Unidos, Canadá, República Dominicana, Puerto Rico…
  { key: "na", label: "Norteamérica", prefixes: ["1"], MARKETING: 0.025, UTILITY: 0.0034 },
  { key: "es", label: "España", prefixes: ["34"], MARKETING: 0.0615, UTILITY: 0.02 },
  { key: "uk", label: "Reino Unido", prefixes: ["44"], MARKETING: 0.0635, UTILITY: 0.022 },
  { key: "de", label: "Alemania", prefixes: ["49"], MARKETING: 0.1365, UTILITY: 0.055 },
  { key: "fr", label: "Francia", prefixes: ["33"], MARKETING: 0.0859, UTILITY: 0.03 },
  { key: "it", label: "Italia", prefixes: ["39"], MARKETING: 0.0691, UTILITY: 0.03 },
  {
    key: "eu",
    label: "Resto de Europa occidental",
    prefixes: ["351", "41", "32", "31", "43", "45", "46", "47", "353", "358", "352"],
    MARKETING: 0.0592,
    UTILITY: 0.0248,
  },
];

/** Una categoría desconocida (o sin categoría) se cobra como MARKETING. */
export const rateCategory = (category: string | null | undefined): RateCategory =>
  (category ?? "").toUpperCase() === "UTILITY" ? "UTILITY" : "MARKETING";

/** El grupo de país de un número (E.164, con o sin «+»): gana el prefijo más largo. */
export const rateGroupFor = (phone: string | null | undefined): RateGroup => {
  const digits = (phone ?? "").replace(/\D/g, "");
  let best: RateGroup = OTHER_RATE_GROUP;
  let bestLength = 0;
  if (!digits) return best;
  for (const group of RATE_GROUPS) {
    for (const prefix of group.prefixes) {
      if (prefix.length > bestLength && digits.startsWith(prefix)) {
        best = group;
        bestLength = prefix.length;
      }
    }
  }
  return best;
};

/** Precio puesto a mano en Plantillas (`whatsapp.templatePrices`); 0 = no puesto. */
export type FlatPrices = { currency: string; MARKETING: number; UTILITY: number };

/**
 * El precio a mano de esta categoría, si lo hay. Solo manda si no es 0: un
 * precio sin poner no puede volver a esconder el costo.
 */
const flatPriceFor = (flat: FlatPrices | null | undefined, category: RateCategory): number | null => {
  const price = flat ? Number(flat[category]) : 0;
  return price > 0 ? price : null;
};

/** Lo que cuesta una plantilla a este número. */
export const templateRateFor = (
  phone: string | null | undefined,
  category: string | null | undefined,
  flat?: FlatPrices | null
): number => {
  const c = rateCategory(category);
  return flatPriceFor(flat, c) ?? rateGroupFor(phone)[c];
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export type CostGroup = { key: string; label: string; count: number; subtotal: number };

export type CostEstimate = {
  total: number;
  currency: string;
  /** `rates`: la tabla de Meta por país; `manual`: el precio puesto en Plantillas. */
  source: "rates" | "manual";
  /** Por grupo de país, del que más cuesta al que menos. */
  groups: CostGroup[];
};

/**
 * Lo que costaría mandar la plantilla a estos números (los que van con
 * plantilla, fuera de las 24 h). Suma la tarifa de cada país.
 */
export const estimateTemplateCost = (
  phones: (string | null | undefined)[],
  category: string | null | undefined,
  flat?: FlatPrices | null
): CostEstimate => {
  const c = rateCategory(category);
  const manual = flatPriceFor(flat, c);
  const byGroup = new Map<string, CostGroup>();
  let total = 0;
  for (const phone of phones) {
    const group = rateGroupFor(phone);
    const price = manual ?? group[c];
    total += price;
    const row = byGroup.get(group.key) ?? { key: group.key, label: group.label, count: 0, subtotal: 0 };
    row.count++;
    row.subtotal += price;
    byGroup.set(group.key, row);
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, subtotal: round4(g.subtotal) }))
    .sort((a, b) => b.subtotal - a.subtotal || b.count - a.count);
  return {
    total: round4(total),
    currency: manual !== null ? flat?.currency || RATE_CURRENCY : RATE_CURRENCY,
    source: manual !== null ? "manual" : "rates",
    groups,
  };
};
