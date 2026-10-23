/**
 * Lo que Dayana no dice, corregido antes de enviar (no depende de que el
 * modelo se acuerde):
 * - «De nada» → «Con gusto».
 * - Frases hechas que no usa: «¿Qué te trae por aquí?», «Qué alegría tenerte
 *   por aquí», «¿Hay algo más en lo que te pueda ayudar?».
 * - Nada de apodos cariñosos («querida», «cariño», «mi amor», «hermosa», «mi
 *   reina», «linda», «amiga»…) ni corazones: la dueña pidió un tono más serio,
 *   aunque amable (2026-10-14). Antes se permitía uno por conversación.
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

// Apodos cariñosos. Los que también son nombres (Bella, Linda, Reina…) solo
// cuentan en minúscula o con «mi» delante.
const PET_ANY = "hermos[ao]|precios[ao]|querid[ao]|cariño|amor|coraz[oó]n|corazoncito|nen[ao]|guap[ao]|amig[ao]|mami|mamita|reina|rey|bell[ao]|lind[ao]|vida|cielo|niñ[ao]|bonit[ao]";
const PET_LOWER_ONLY = new Set(["bella", "bello", "linda", "lindo", "reina", "rey", "vida", "cielo", "niña", "niño", "bonita", "bonito"]);
// Delante de un nombre («Querida María»): solo los que nunca son otra cosa.
const PET_BEFORE_NAME_WORDS = "[Qq]uerid[ao]|[Hh]ermos[ao]|[Pp]recios[ao]|[Cc]ariño|[Nn]en[ao]|[Gg]uap[ao]";
const PET_VOCATIVE = `(?:${PET_ANY})`;

// «mi hermosa», «mi amor», «mi reina» (no «mi amiga»: puede ser literal).
const MY_PET = new RegExp(String.raw`(,\s*)?\bmi\s+(?:${PET_ANY.replace("|amig[ao]", "")})\b(\s*,)?`, "giu");
// «Gracias, hermosa.» / «Te bendigo, amiga!»: el apodo al final de la frase.
const TRAILING_PET = new RegExp(String.raw`,\s*(${PET_VOCATIVE})(?=\s*(?:[.!?…\n]|$))`, "giu");
// «Hola querida, …» / «Querida, …»: al empezar la frase o después del saludo.
const LEADING_PET = new RegExp(
  String.raw`(^|[.!?¡¿\n]\s*|\b(?:hola|buenas|buenos días|buenas tardes|buenas noches|gracias)\s+)(${PET_VOCATIVE})(\s*,\s*|\s+(?=[¿¡]))`,
  "giu"
);
// «Querida María» → «María».
const PET_BEFORE_NAME = new RegExp(String.raw`\b(?:${PET_BEFORE_NAME_WORDS})\s+(?=\p{Lu}\p{Ll})`, "gu");
const HEART = /(?:💛|❤️|❤|🤍|💖|💕|💗|💓|🥰|😍|💙|💜|🧡|💚|😘|💞|💝)/gu;

/** ¿Este apodo, tal como está escrito, es un apodo (y no un nombre propio)? */
const isPet = (word: string): boolean => {
  const lower = word.toLocaleLowerCase("es");
  if (!PET_LOWER_ONLY.has(lower)) return true;
  return word === lower;
};

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
        // Mayúscula al empezar y después de un punto (no en «3:00 p. m.», ni en un
        // enlace o un correo: «Https://…» no abre, Ruth, 23-oct).
        .replace(/(^|[.!?]\s+)([¿¡]?)(\p{Ll})/gu, (full: string, a: string, b: string, c: string, offset: number, whole: string) =>
          /(?:(?:^|[\s(\d])[ap]\.|[ap]\.\s?m\.)\s+$/i.test(whole.slice(0, offset + a.length)) ||
          /^(?:https?:|www\.)|^[^\s@]+@/i.test(whole.slice(offset + a.length + b.length))
            ? full
            : `${a}${b}${c.toUpperCase()}`
        )
        .trim()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Quita los apodos cariñosos sin dejar la frase rota. */
export const dropEndearments = (text: string): string =>
  text
    .replace(MY_PET, (_m: string, before: string | undefined, after: string | undefined, offset: number, whole: string) => {
      if (before && after) return ", ";
      if (after) {
        // «Hola mi hermosa, te bendigo» → «Hola, te bendigo»; al empezar, nada.
        const prev = whole.slice(0, offset).trimEnd();
        return prev && !/[.!?¡¿\n]$/.test(prev) ? ", " : "";
      }
      return "";
    })
    .replace(TRAILING_PET, (m: string, pet: string) => (isPet(pet) ? "" : m))
    .replace(LEADING_PET, (m: string, lead: string, pet: string) => {
      if (!isPet(pet)) return m;
      // Después de «Hola»/«Gracias» queda la coma; al empezar una frase, nada.
      return /[\p{L}]\s+$/u.test(lead) ? `${lead.trimEnd()}, ` : lead;
    })
    .replace(PET_BEFORE_NAME, "");

/** Quita un corazón; si separaba dos frases («… 💛 Me alegra»), deja un punto. */
const dropHeart = (text: string): string =>
  text.replace(new RegExp(`\\s*${HEART.source}\\s*`, "gu"), (m, offset: number, whole: string) => {
    const prev = whole.slice(0, offset).trimEnd().slice(-1);
    const next = whole.slice(offset + m.length).trimStart().charAt(0);
    if (!prev || !next) return "";
    if (/[\p{L}\d)]/u.test(prev) && /[\p{Lu}¿¡]/u.test(next)) return ". ";
    return m.includes("\n") ? "\n" : " ";
  });

/** Deja el mensaje como lo diría Dayana (con el tono que pidió la dueña). */
export const polishReply = (text: string): string => {
  const original = withDayanaWording(text);
  let out = original;
  for (const re of BANNED) out = out.replace(re, " ");
  out = dropHeart(dropEndearments(out));
  const result = tidy(out);
  // Nunca se manda vacío: si todo era frase hecha, queda el original sin apodos.
  return result || tidy(dropHeart(dropEndearments(original))) || tidy(original);
};

/**
 * Para lo que la IA LEE (ejemplos reales, guía de estilo): sin apodos ni
 * corazones, para que no aprenda a ponerlos.
 */
export const softenForPrompt = (text: string): string => tidy(dropHeart(dropEndearments(text)));
