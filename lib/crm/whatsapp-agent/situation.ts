import { isAutoSend } from "../whatsapp-attention-rules";

/**
 * ¿Es la primera vez que esta persona escribe, o ya hubo conversación?
 *
 * Se cuenta sobre los mensajes reales del chat (no solo los que lee la IA), sin
 * lo que la persona acaba de escribir. Los envíos que salen solos (masivos,
 * recordatorios, invitaciones) no son conversación: alguien que solo recibió
 * la invitación al evento sigue siendo nueva, y un «gracias» a esa invitación
 * tampoco cuenta como haber conversado.
 *
 * Puro: lo usan `run.ts` y las pruebas.
 */

export type SituationMessage = {
  direction: "INBOUND" | "OUTBOUND";
  kind?: string | null;
  source?: string | null;
  clientKey?: string | null;
  status?: string | null;
};

export type Situation = {
  isNew: boolean;
  /** Mensajes suyos antes de lo que acaba de escribir. */
  priorInbound: number;
  /** Respuestas de Dayana o de la asistente antes (sin masivos ni recordatorios). */
  priorReplies: number;
  /** Envíos automáticos que recibió (invitaciones, recordatorios…). */
  autoSends: number;
};

export const conversationSituation = (messages: SituationMessage[]): Situation => {
  const real = messages.filter((m) => m.kind !== "system" && m.status !== "FAILED");
  let end = real.length;
  while (end > 0 && real[end - 1].direction === "INBOUND") end--;
  const prior = real.slice(0, end);
  const priorInbound = prior.filter((m) => m.direction === "INBOUND").length;
  const outbound = prior.filter((m) => m.direction !== "INBOUND");
  const autoSends = outbound.filter((m) => isAutoSend(m)).length;
  const priorReplies = outbound.length - autoSends;
  return {
    isNew: priorReplies === 0 && priorInbound < 2,
    priorInbound,
    priorReplies,
    autoSends,
  };
};

/** La línea «SITUACIÓN DEL CHAT» del prompt. */
export const situationText = (s: Situation, inCrm: boolean): string => {
  if (!s.isNew) {
    return `PERSONA CON CONVERSACIÓN PREVIA (${s.priorInbound} mensajes suyos y ${s.priorReplies} respuestas antes): NO es la primera vez. Lee el hilo, no la saludes como nueva ni repitas preguntas que ya respondió; sigue donde quedó.`;
  }
  const known = s.autoSends > 0 ? " Solo había recibido mensajes automáticos (invitaciones o recordatorios)." : "";
  const crm = inCrm ? " Está en el CRM: mira CLIENTA EN EL CRM." : "";
  return `PERSONA NUEVA: es la primera vez que conversa con nosotros.${known}${crm}`;
};
