import { isSilencingCategory } from "./chat-category-rules";
import { isAutoSend } from "./whatsapp-attention-rules";

/**
 * De qué aprende la IA y de qué no. Puro: lo usan `whatsapp-learning.ts`, la
 * limpieza (`whatsapp-agent/ai-reset.ts`) y las pruebas.
 *
 * Solo enseña lo que Dayana escribió de verdad, contestándole a alguien de su
 * trabajo. No enseña:
 * - lo que escribió la IA, ni sus borradores aprobados (aunque Dayana los haya
 *   retocado: siguen siendo la forma de la IA, y lo que Dayana cambió ya lo
 *   recoge el aprendizaje de correcciones);
 * - lo que sale solo (masivos, recordatorios, saludo automático, avisos del
 *   evento) ni los avisos grises (`system`);
 * - los chats personales, del equipo o de empresas;
 * - los textos que Dayana pega igual en muchos chats (la respuesta rápida de
 *   la app, el mensaje de bienvenida o de ausencia, una difusión): son
 *   plantillas con datos viejos (precios, fechas), no su forma de conversar.
 */

export type LearningMessage = {
  direction: string;
  isAutoReply?: boolean | null;
  kind?: string | null;
  source?: string | null;
  clientKey?: string | null;
};

/** ¿Este mensaje lo escribió Dayana contestando? */
export const isHumanReply = (m: LearningMessage): boolean =>
  m.direction === "OUTBOUND" && !m.isAutoReply && m.kind !== "system" && m.source !== "approval" && !isAutoSend(m);

export type LearningChat = {
  isTeam?: boolean;
  ignoredNumber?: boolean;
  segment?: string | null;
  category?: string | null;
  categorySource?: string | null;
  categoryConfidence?: number | null;
  categoryReview?: boolean | null;
};

/**
 * ¿Se aprende de este chat? No de los números personales o del equipo, ni de
 * lo que la clasificación ya da por personal, equipo o empresa con seguridad
 * (aunque la clasificación esté apagada: aprender de la familia nunca sirve).
 */
export const isLearnableChat = (c: LearningChat): boolean => {
  if (c.isTeam || c.ignoredNumber || c.segment === "ignored") return false;
  return !isSilencingCategory(
    { category: c.category, categorySource: c.categorySource, categoryConfidence: c.categoryConfidence, categoryReview: c.categoryReview },
    { enabled: true }
  );
};

/**
 * Un texto igual en tantos chats distintos es una plantilla (respuesta rápida,
 * bienvenida, difusión), no una respuesta. Los cortos («Con gusto, te
 * bendigo») sí se repiten de verdad y se quedan.
 */
export const REPEATED_MIN_CHATS = 5;
export const REPEATED_MIN_CHARS = 40;

export const normalizeReply = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Las respuestas que son plantillas, por texto normalizado. */
export const repeatedReplies = (examples: { conversationId: string | null; replyText: string }[]): Set<string> => {
  const chats = new Map<string, Set<string>>();
  for (const e of examples) {
    const text = normalizeReply(e.replyText);
    if (text.length < REPEATED_MIN_CHARS || !e.conversationId) continue;
    const set = chats.get(text) ?? new Set<string>();
    set.add(e.conversationId);
    chats.set(text, set);
  }
  return new Set([...chats].filter(([, set]) => set.size >= REPEATED_MIN_CHATS).map(([text]) => text));
};
