import { foldForSearch } from "../search-normalize";

/**
 * Cuánto esperar antes de contestar (puro). Auditoría del 13-nov: la mediana
 * de respuesta era 12 s y el 21 % de las respuestas de la IA salieron mientras
 * la persona seguía escribiendo (otro mensaje suyo llegaba en los 20 s
 * siguientes): «Con gusto 🙏» a medias, lo que dijo después mal leído
 * (Johanna, Judith). Se espera a que termine: lo normal, `baseMs`; si lo
 * último parece a medias (un saludo solo, una frase cortada, «y», «pero»,
 * coma al final), más.
 */
const UNFINISHED_END = /(,|\.\.\.|…|\b(y|o|que|pero|porque|pues|entonces|osea|o sea|tambien|ademas|como|cuando|si|me|mi|mis|tu|su|la|las|el|los|un|una|de|del|al|a|en|para|con|por|sobre|sin|hasta|desde)\s*)$/;
const GREETING_ONLY = /^(hola|holi|buen(as|os)? (dias|tardes|noches)|buenas|saludos|que tal|hola dayana|hola buenas( tardes| noches| dias)?)[\s!.¡]*$/;

export const waitBeforeReplyMs = (lastText: string | null | undefined, baseMs: number): number => {
  const raw = (lastText ?? "").trim();
  // Una nota de voz o un archivo: ya es un mensaje completo.
  if (!raw || raw.startsWith("🎤")) return baseMs;
  const t = foldForSearch(raw).replace(/\s+/g, " ").trim();
  if (GREETING_ONLY.test(t) || UNFINISHED_END.test(t)) return Math.round(baseMs * 1.75);
  return baseMs;
};

/**
 * El aviso de espera de la IA («Déjame consultarlo con Dayana…», «Ya le paso tu
 * mensaje…»). Auditoría del 13-nov: 167 en 92 chats, el mismo repetido 15 veces
 * en 24 h. Uno basta: Dayana ya está avisada.
 */
const HOLDING = /\b(dejame (consultarlo|confirmarlo|revisar|avisarle|preguntarle|comentarselo|pasarle)|(ya )?le (paso|comento|aviso|consulto) (tu|su|el|este|esto)|le paso tu (mensaje|pedido|caso)|ya le aviso a dayana)\b/;
export const isHoldingLine = (text: string | null | undefined): boolean => HOLDING.test(foldForSearch(text ?? ""));
