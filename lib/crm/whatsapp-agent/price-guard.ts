/**
 * Los precios solo los da Dayana, en la llamada. Esto detecta si un mensaje
 * menciona un monto o un valor, para que nunca salga solo (y para borrar los
 * montos de los ejemplos viejos que ve la IA).
 */

const PATTERNS: RegExp[] = [
  // $150.000 · $ 150,000 · $80 · US$50 · COP 150000
  /(?:US\s?)?\$\s?\d[\d.,]*/i,
  /\b(?:COP|USD|EUR|MXN|ARS)\s?\$?\s?\d[\d.,]*/i,
  /\d[\d.,]*\s?(?:COP|USD|EUR|MXN|ARS|d[oó]lares|pesos|euros|lucas)\b/i,
  // 150.000 · 1.200.000 · 150,000 (miles con separador)
  /\b\d{1,3}(?:[.,]\d{3})+\b/,
  // 150 mil · 1 millón · 2 millones
  /\b\d+(?:[.,]\d+)?\s?(?:mil|millones?|mill[oó]n|k)\b/i,
  // «cuesta 80», «vale 200», «el valor es 90», «precio: 120»
  /\b(?:cuesta|cuestan|vale|valen|valor(?:\s+es)?|precio(?:\s+es)?|inversi[oó]n(?:\s+es)?|te\s+sale|sale\s+en)\s*(?:de\s+)?:?\s*\$?\s?\d/i,
];

/** ¿El mensaje dice un monto o un precio? */
export const mentionsPrice = (text: string | null | undefined): boolean => {
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text));
};

/** Borra los montos de un texto (ejemplos viejos de Dayana, memoria). */
export const redactPrices = (text: string): string => {
  let out = text;
  for (const re of PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), "[precio]");
  return out;
};
