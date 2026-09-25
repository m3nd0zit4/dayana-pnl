/**
 * Lo que Dayana no dice, corregido antes de enviar (no depende de que el
 * modelo se acuerde):
 * - «De nada» → «Con gusto».
 * - Frases hechas que no usa: «¿Qué te trae por aquí?», «Qué alegría tenerte
 *   por aquí», «¿Hay algo más en lo que te pueda ayudar?».
 * - «mi hermosa» / «mi bella» y los corazones no se repiten: si ya salieron
 *   en los últimos mensajes del chat, se quitan; y como mucho uno por mensaje.
 */

export const withDayanaWording = (text: string): string =>
  text.replace(/(^|[.!?¡¿\n]\s*)de nada\b/gi, "$1Con gusto");

const BANNED: RegExp[] = [
  // «Cuéntame, ¿qué te trae por aquí (hoy)?» / «¿Y qué la trae por acá?»
  /(?:cu[eé]ntame,?\s*)?¿?\s*(?:y\s+)?qu[eé]\s+(?:te|la|lo|los|las|les)\s+trae\s+por\s+(?:aqu[ií]|ac[aá])(?:\s+hoy)?\s*\??/gi,
  // «¡Qué alegría tenerte por aquí!» / «Qué alegría leerte por acá, …»
  /¡?\s*qu[eé]\s+alegr[ií]a\s+(?:tenerte|leerte|verte|saludarte)\s+por\s+(?:aqu[ií]|ac[aá])[^.!?\n]*[.!?]*/gi,
  // «¿Hay algo más en lo que te pueda ayudar hoy?»
  /¿?\s*hay\s+algo\s+m[aá]s\s+en\s+(?:lo\s+)?(?:que|qu[eé])\s+(?:te\s+)?(?:pueda|puedo)\s+(?:ayudar|servir)[^?\n]*\??/gi,
];

// «Bella» sola puede ser un nombre: solo cuenta «mi bella».
const ENDEARMENT = /(,\s*)?\b(?:mi\s+(?:hermosa|bella)|hermosa)\b(\s*,)?/gi;
const HEART = /(?:💛|❤️|❤|🤍|💖|💕|💗|💓|🥰|😍|💙|💜|🧡|💚)/gu;

const hasEndearment = (t: string) => /\b(?:mi\s+(?:hermosa|bella)|hermosa)\b/i.test(t);
const hasHeart = (t: string) => new RegExp(HEART.source, "u").test(t);

/** Espacios, comas sueltas y mayúsculas después de quitar algo. */
const tidy = (text: string): string =>
  text
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/,\s*([.!?])/g, "$1")
        .replace(/([¿¡])\s+/g, "$1")
        .replace(/,{2,}/g, ",")
        .replace(/^[\s,.;:]+/, "")
        .replace(/[\s,;:]+$/, "")
        // Mayúscula al empezar y después de un punto (no en «3:00 p. m.»).
        .replace(/(^|[.!?]\s+)([¿¡]?)(\p{Ll})/gu, (full: string, a: string, b: string, c: string, offset: number, whole: string) =>
          /(?:(?:^|[\s(\d])[ap]\.|[ap]\.\s?m\.)\s+$/i.test(whole.slice(0, offset + a.length)) ? full : `${a}${b}${c.toUpperCase()}`
        )
        .trim()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Quita un apodo cariñoso sin dejar la frase rota: «Te bendigo, mi hermosa.»
 * → «Te bendigo.»; «Mi hermosa, te bendigo» → «Te bendigo».
 */
const dropEndearment = (
  _m: string,
  before: string | undefined,
  after: string | undefined,
  offset: number,
  whole: string
): string => {
  if (before && after) return ", ";
  if (after) {
    // «Hola mi hermosa, te bendigo» → «Hola, te bendigo»; al empezar, nada.
    const prev = whole.slice(0, offset).trimEnd();
    return prev && !/[.!?¡¿\n]$/.test(prev) ? ", " : "";
  }
  return "";
};

/** Quita un corazón; si separaba dos frases («… 💛 Me alegra»), deja un punto. */
const dropHeart = (text: string): string =>
  text.replace(new RegExp(`\\s*${HEART.source}\\s*`, "gu"), (m, offset: number, whole: string) => {
    const prev = whole.slice(0, offset).trimEnd().slice(-1);
    const next = whole.slice(offset + m.length).trimStart().charAt(0);
    if (!prev || !next) return "";
    if (/[\p{L}\d)]/u.test(prev) && /[\p{Lu}¿¡]/u.test(next)) return ". ";
    return m.includes("\n") ? "\n" : " ";
  });

/**
 * Deja el mensaje como lo diría Dayana. `recentOutbound`: los últimos
 * mensajes que ya salieron en este chat (de la IA o de Dayana).
 */
export const polishReply = (text: string, recentOutbound: string[] = []): string => {
  const original = withDayanaWording(text);
  let out = original;
  for (const re of BANNED) out = out.replace(re, " ");

  // Apodo: si ya se dijo hace poco, fuera; si no, solo el primero del mensaje.
  const endearmentUsed = recentOutbound.some(hasEndearment);
  let keptEndearment = false;
  out = out.replace(ENDEARMENT, (m: string, before: string | undefined, after: string | undefined, offset: number, whole: string) => {
    if (!endearmentUsed && !keptEndearment) {
      keptEndearment = true;
      return m;
    }
    return dropEndearment(m, before, after, offset, whole);
  });

  // Corazones: ninguno si ya hubo uno hace poco; si no, como mucho uno.
  if (recentOutbound.some(hasHeart)) {
    out = dropHeart(out);
  } else {
    let seen = false;
    const parts = out.split(new RegExp(`(${HEART.source})`, "u"));
    if (parts.length > 3) {
      out = dropHeart(
        parts
          .map((p) => {
            if (!new RegExp(`^${HEART.source}$`, "u").test(p)) return p;
            if (seen) return "\u0000";
            seen = true;
            return "\u0001";
          })
          .join("")
          .replace(/\u0000/g, "💛")
      ).replace(/\u0001/g, "💛");
    }
  }

  const result = tidy(out);
  // Nunca se manda vacío: si todo era frase hecha, queda el original.
  return result || tidy(original);
};

/**
 * Para lo que la IA LEE (ejemplos reales, guía de estilo): sin «mi hermosa» ni
 * corazones, para que no aprenda a ponerlos en cada mensaje.
 */
export const softenForPrompt = (text: string): string =>
  tidy(dropHeart(text.replace(ENDEARMENT, dropEndearment)));
