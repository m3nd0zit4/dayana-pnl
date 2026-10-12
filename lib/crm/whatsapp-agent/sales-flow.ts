import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { foldForSearch } from "../search-normalize";

/**
 * El flujo de primera vez (pedido de la dueña): la asistente personal de
 * Dayana saluda, pregunta cómo está y de dónde escribe, escucha, encuentra lo
 * que mueve a la persona a buscar ayuda (los «botones», un concepto interno
 * que nunca se le dice), hace la pregunta clave para eso e invita a la llamada
 * gratis de 15 minutos, con horas reales del calendario. Dayana cierra la
 * venta en la llamada.
 *
 * Puro: arma el texto del prompt y el «ya hecho / siguiente paso» a partir de
 * la conversación, para que no repita pasos ni salude dos veces.
 */

export type FlowLine = { direction: "INBOUND" | "OUTBOUND"; body: string | null };

export type FlowState = {
  greeted: boolean;
  askedFeeling: boolean;
  askedCountry: boolean;
  keyQuestion: boolean;
  invited: boolean;
  offeredSlots: boolean;
  declined: boolean;
};

const GREETING = /\b(hola|te bendigo|buen(os|as) (dias|tardes|noches))\b/;
const FEELING = /\bcomo (estas|te sientes|te has sentido|te encuentras|vas)\b/;
const COUNTRY = /\b(desde que (pais|ciudad)|de donde (me )?escribes|en que (pais|ciudad) (estas|vives))\b/;
const KEY_QUESTION = /\bcuanto tiempo mas\b/;
const INVITE = /\bllamada (gratis|gratuita)|\bconsulta (gratis|gratuita)|\b15 minutos\b/;
const SLOTS = /\b(tu hora|en colombia)\b/;
const DECLINE = /\b(no (puedo|quiero|me interesa|gracias|por ahora)|despues te (digo|escribo|aviso)|mas adelante|ahorita no|otro dia)\b/;

export const flowState = (lines: FlowLine[], opts: { keyQuestions?: string[]; offeredSlots?: boolean } = {}): FlowState => {
  const keys = (opts.keyQuestions ?? []).map((q) => foldForSearch(q).slice(0, 30)).filter((q) => q.length >= 12);
  const state: FlowState = {
    greeted: false,
    askedFeeling: false,
    askedCountry: false,
    keyQuestion: false,
    invited: false,
    offeredSlots: Boolean(opts.offeredSlots),
    declined: false,
  };
  for (const line of lines) {
    const text = foldForSearch(line.body ?? "");
    if (!text) continue;
    if (line.direction === "OUTBOUND") {
      if (GREETING.test(text)) state.greeted = true;
      if (FEELING.test(text)) state.askedFeeling = true;
      if (COUNTRY.test(text)) state.askedCountry = true;
      if (KEY_QUESTION.test(text) || keys.some((k) => text.includes(k))) state.keyQuestion = true;
      if (INVITE.test(text)) state.invited = true;
      if (SLOTS.test(text)) state.offeredSlots = true;
    } else if (state.invited && DECLINE.test(text)) {
      state.declined = true;
    }
  }
  return state;
};

/** El siguiente paso del flujo según lo que ya se hizo. */
export const nextStep = (s: FlowState): string => {
  if (s.declined) return "dijo que no o que después: no insistas; despídete con calidez y deja la puerta abierta";
  if (!s.greeted) return "saludar como asistente de Dayana y preguntar cómo está";
  if (!s.askedCountry) return "preguntar desde qué país (y ciudad, si el país tiene varias horas) escribe";
  if (!s.keyQuestion && !s.invited) return "escuchar lo que le pasa; cuando aparezca lo que la mueve, hacer su pregunta clave";
  if (!s.invited) return "invitarla a la llamada gratis de 15 minutos con Dayana";
  if (!s.offeredSlots) return "si aceptó, ofrecerle horas con offer_free_call_slots";
  return "si eligió una hora, agendarla con book_free_call; si no, ayudarla a elegir";
};

export const flowStateText = (s: FlowState): string => {
  const done = [
    s.greeted && "saludo",
    s.askedFeeling && "preguntar cómo está",
    s.askedCountry && "preguntar de dónde escribe",
    s.keyQuestion && "pregunta clave",
    s.invited && "invitación a la llamada gratis",
    s.offeredSlots && "horas ofrecidas",
  ].filter(Boolean);
  return [
    done.length ? `YA HECHO EN ESTE CHAT (no lo repitas): ${done.join(", ")}.` : "YA HECHO EN ESTE CHAT: nada todavía.",
    `SIGUIENTE PASO: ${nextStep(s)}.`,
  ].join("\n");
};

/** Las reglas de la persona nueva y de la que ya conversó, con el flujo de la dueña. */
export const salesFlowRules = (config: WhatsAppAiConfig, opts: { autoBook: boolean }): string => {
  const keyQuestions = config.salesFlow.buyButtons
    .filter((b) => b.enabled)
    .map((b) => `    · ${b.label}: «${b.keyQuestion}»`)
    .join("\n");
  const booked = opts.autoBook
    ? "Queda agendada al instante: confírmale el día y la hora (en su hora) y que Dayana la llama por WhatsApp a este número."
    : "Queda lista para que Dayana la confirme: dile que en un momento le confirmamos la hora por aquí.";
  return `- Eres la ASISTENTE PERSONAL de Dayana (no eres Dayana). Puedes usar su calidez y su forma de hablar, pero hablas como su asistente: «Dayana te escucha», «te agendo con Dayana».
- PERSONA NUEVA (mira SITUACIÓN DEL CHAT y YA HECHO): tu único objetivo es que agende la LLAMADA GRATIS de 15 minutos con Dayana (sin costo ni compromiso; Dayana es quien explica los procesos y cierra en la llamada). Un paso por mensaje, en este orden, sin saltarte ninguno ni repetir lo que ya se hizo:
  1. Saludo: «Hola [nombre], te bendigo. Soy la asistente de Dayana. ¿Cómo estás?» (si no sabes el nombre, sin nombre).
  2. De dónde escribe: «¿Desde qué país me escribes?» (y la ciudad en México, Estados Unidos, Brasil, Canadá, España, Argentina o Chile). Cuando lo diga, usa save_country.
  3. Escucha lo que le pasa (emocional, económico, de pareja, de salud…). Refleja en UNA frase lo que siente, con sus propias palabras. No la interrogues.
  4. Cuando aparezca lo que la mueve a buscar ayuda, haz SU pregunta clave (lista abajo), una sola vez. Es interno: nunca digas «botón», ni categorías, ni que estás siguiendo un guion.
  5. Invitación: «Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso. Ella te escucha y te dice cómo te puede ayudar.»
  6. Si acepta: usa offer_free_call_slots y escríbele las horas tal cual salen (en su hora y la de Colombia), 2 o 3. Cuando elija una, usa book_free_call con esa hora exacta. ${booked} Si ninguna le sirve, vuelve a usar offer_free_call_slots o pregúntale qué día le queda mejor.
  7. Si dice que no o que después: no insistas. «Listo, perfecto. Quedamos en contacto; si necesitas algo, me escribes por aquí.»
  PREGUNTAS CLAVE (según lo que la mueve):
${keyQuestions}
  Si lo que la mueve no está en la lista, usa «¿Cuánto tiempo más quieres seguir así?».
- Lo emocional (tristeza, ansiedad, duelo, autoestima, soledad…) NO es motivo para pasarle el chat a Dayana: es justo lo que Dayana trabaja. Escucha y sigue el flujo. Solo escala como clinical si hay una crisis, riesgo, o habla de hacerse daño (severity=urgent).
- PERSONA CON CONVERSACIÓN PREVIA: lee el hilo y la FICHA y sigue donde quedó: no la saludes como nueva ni repitas preguntas que ya respondió. Si ya se la invitó y no agendó, retoma con suavidad desde lo que le pasaba. Si quiere agendar la llamada gratis: offer_free_call_slots y book_free_call. Si quiere cambiar o cancelar una cita que ya tiene, escala con category=reschedule. Si no sabes qué decir, escala con category=unknown.
`;
};
