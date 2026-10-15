import { foldForSearch } from "../search-normalize";

/**
 * ¿La asistente ya le dijo esto hace poco? Con las pausas apagadas, cada
 * «gracias» o «sí» después de escalar volvía a mandar el mismo aviso: a una
 * persona le llegó «Déjame avisarle a Dayana para que te agregue al grupo…»
 * cuatro veces seguidas (14-oct-2026).
 *
 * Puro. Igual, o uno contiene al otro, o casi las mismas palabras.
 */

const normalize = (text: string) =>
  foldForSearch(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Los números cuentan siempre: «jueves 15» y «jueves 22» no son lo mismo.
const words = (text: string) => new Set(text.split(" ").filter((w) => w.length > 2 || /\d/.test(w)));

export const sameMessage = (a: string, b: string): boolean => {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 25 && long.includes(short)) return true;
  const wa = words(x);
  const wb = words(y);
  if (wa.size < 4 || wb.size < 4) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / new Set([...wa, ...wb]).size >= 0.8;
};

export const alreadySaid = (text: string, previous: (string | null | undefined)[]): boolean =>
  previous.some((p) => Boolean(p?.trim()) && sameMessage(text, p!));
