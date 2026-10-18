import { foldForSearch } from "../search-normalize";

/** Reglas puras de la ficha (`dossier.ts`): también las usa Personas. */

export type SaidGender = "femenino" | "masculino";

/**
 * El resumen sin frases que dicen si es hombre o mujer. Las fichas viejas lo
 * adivinaban por el nombre («- Felicitas es mujer y se inscribió…», 18-oct) y
 * la IA y Personas lo leían. «es mujer y se inscribió» → «se inscribió».
 */
export const withoutGuessedGender = (summary: string): string =>
  summary
    .split("\n")
    .filter((line) => !/^\s*-?\s*g[eé]nero\b/i.test(line))
    .map((line) => line.replace(/\b(?:es|era)\s+(?:una\s+|un\s+)?(?:mujer|hombre)\b(?:\s*,?\s*y\s+)?/giu, ""))
    .filter((line) => /[\p{L}\d]/u.test(line))
    .map((line) => line.replace(/^(\s*-\s*)(\p{Ll})/u, (_m, pre: string, ch: string) => `${pre}${ch.toLocaleUpperCase("es")}`).replace(/\s+([.,])/g, "$1"))
    .join("\n");

/**
 * El género que trae el modelo vale solo si sus palabras están en lo que la
 * persona escribió (o ya estaba comprobado en la ficha anterior).
 */
export const checkedGender = (
  facts: { genderSaid?: SaidGender | null; genderQuote?: string | null },
  personText: string,
  previous: { genderSaid?: SaidGender | null; genderQuote?: string | null } | null
): { genderSaid: SaidGender | null; genderQuote: string | null } => {
  const quote = facts.genderQuote?.replace(/[«»"“”']/g, "").trim() ?? "";
  if (facts.genderSaid && quote.length >= 4 && foldForSearch(personText).includes(foldForSearch(quote))) {
    return { genderSaid: facts.genderSaid, genderQuote: quote };
  }
  if (previous?.genderSaid && previous.genderQuote) return { genderSaid: previous.genderSaid, genderQuote: previous.genderQuote };
  return { genderSaid: null, genderQuote: null };
};
