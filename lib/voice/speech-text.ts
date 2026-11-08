/**
 * Lo que el asistente dice en voz alta. Puro (sin React, sin red): lo usan el
 * panel (voz del navegador), las notas de voz de WhatsApp y las llamadas.
 *
 * Las respuestas del agente vienen en Markdown (negritas, listas, tablas,
 * enlaces). Leído tal cual, el sintetizador dice «asterisco asterisco» o deletrea
 * una URL entera; aquí se queda solo lo que una persona diría.
 */

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;

/** Markdown → texto plano para hablar. `maxChars` corta en una frase completa. */
export const toSpeechText = (markdown: string, opts: { maxChars?: number } = {}): string => {
  let text = markdown.replace(/\r\n?/g, "\n");
  // Bloques de código y tablas no se leen: se avisa que están en pantalla.
  text = text.replace(/```[\s\S]*?```/g, "\n(te lo dejé en pantalla)\n");
  const lines = text.split("\n");
  const kept: string[] = [];
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) {
      if (!inTable) kept.push("(la tabla te la dejé en pantalla)");
      inTable = true;
      continue;
    }
    inTable = false;
    if (/^[-*_]{3,}$/.test(line)) continue;
    kept.push(line);
  }
  text = kept.join("\n");
  text = text
    // [texto](url) → texto; una URL suelta → «el enlace».
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "el enlace")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    // Viñetas y listas numeradas: cada punto es una frase.
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/gm, (_m, item: string) => (/[.!?…:]$/.test(item) ? item : `${item}.`))
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(EMOJI, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:;,]$/.test(l) ? l : `${l}.`))
    .join(" ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .trim();

  const max = opts.maxChars;
  if (max && text.length > max) {
    const cut = text.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    text = `${(end > max * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim()} El resto te lo dejé en pantalla.`;
  }
  return text;
};

/**
 * Trozos para `speechSynthesis`: Chrome corta en silencio una frase larga
 * (~15 s) y en el teléfono una sola `utterance` larga a veces ni empieza. Se
 * parte por frases y, si una frase sola es muy larga, por comas.
 */
export const splitForSpeech = (text: string, maxLen = 200): string[] => {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (!piece) return;
    if (current && `${current} ${piece}`.length > maxLen) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  };
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) {
      push(sentence);
      continue;
    }
    for (const part of sentence.split(/(?<=[,;:])\s+/)) {
      if (part.length <= maxLen) push(part);
      else for (let i = 0; i < part.length; i += maxLen) push(part.slice(i, i + maxLen));
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const YES = /^(?:si|sii+|sip|claro|dale|listo|ok|okey|okay|de acuerdo|hazlo|aprobado|apruebo|adelante|correcto|exacto|perfecto|va|vale|confirmo|si señor|si senor)(?:\s+(?:si|claro|dale|hazlo|por favor|porfa|gracias|apruebalo|mandalo|envialo|adelante|de una|confirmo|listo))*$/;
const NO = /^(?:no|nop|nope|cancela|cancelalo|cancelar|para|detente|espera|todavia no|aun no|mejor no|no gracias|no lo hagas|negativo)(?:\s+.*)?$/;

/**
 * Respuesta hablada a la tarjeta de aprobación. Solo cuenta una respuesta
 * corta y clara: «sí», «dale», «sí, hazlo». «Sí, pero cámbiale la hora» no
 * aprueba (es una corrección) y se manda como mensaje normal.
 */
export const spokenDecision = (transcript: string): "approve" | "deny" | null => {
  const t = fold(transcript);
  if (!t || t.split(" ").length > 6) return null;
  if (YES.test(t)) return "approve";
  if (NO.test(t)) return "deny";
  return null;
};

/** Lo que el asistente dice al pedir aprobación (sin leer IDs ni JSON). */
export const spokenApprovalPrompt = (summary: {
  title: string;
  lines?: readonly { label: string; value: string }[];
}): string => {
  const detail = (summary.lines ?? [])
    .slice(0, 3)
    .map((l) => `${l.label}: ${toSpeechText(l.value, { maxChars: 160 }).replace(/\.$/, "")}`)
    .join(". ");
  return `Necesito tu aprobación para: ${summary.title.replace(/\.$/, "")}.${detail ? ` ${detail}.` : ""} ¿Lo hago? Di sí o no, o toca Aprobar.`;
};
