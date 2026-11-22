import type { Stage } from "./stage";

/**
 * Las reglas y herramientas según la etapa de la persona (fase 6 de la arquitectura, 22-nov:
 * «el modelo solo ve lo que puede hacer en el paso en que está»). Antes todas las personas que
 * no eran clientas recibían las mismas reglas: a quien ya tenía la llamada agendada se le
 * explicaba el embudo entero (saludo, país, pregunta clave, invitación…), a quien no tenía
 * ninguna cita se le daba `confirm_appointment` (Ever, 21-nov: le llegó «Confirm_appointment»),
 * y a quien ya tuvo la llamada le tocaban las reglas viejas de «PERSONA NUEVA».
 *
 * - `full`: como siempre (interruptor apagado, clienta, inscrita a un evento, hablando del
 *   taller, ya fue clienta o por revisar, sin etapa en un chat con llamada próxima).
 * - `lead`: nueva, conversando o no contestó, sin llamada próxima: el flujo de venta, sin
 *   herramienta para confirmar citas.
 * - `booked`: tiene la llamada gratis agendada: sin el embudo; contestar, acompañar y moverla.
 * - `after_call`: ya tuvo su llamada: sin el embudo ni las reglas de persona nueva.
 *
 * Pocas variantes a propósito: cada una es un prefijo fijo que la caché de Gemini reutiliza.
 */
export type PromptScope = "full" | "lead" | "booked" | "after_call";

export const promptScope = (input: {
  enabled: boolean;
  stage: Stage | null | undefined;
  clientMode?: boolean;
  /** Inscrita a un evento gratuito y sin pedir nada personal (`guestFreeEvent`). */
  guest?: boolean;
  /** Hablando del taller abierto (`workshopFlowActive`): sigue su propio camino. */
  workshopFlow?: boolean;
  /** Ya tiene una llamada gratis próxima (aunque la etapa no se haya recalculado). */
  upcomingCall?: boolean;
}): PromptScope => {
  if (!input.enabled || input.clientMode || input.guest || input.workshopFlow) return "full";
  switch (input.stage) {
    case "llamada_agendada":
      return "booked";
    case "nueva":
    case "conversando":
    case "no_contesto":
      // La etapa se recalcula en el reloj: una llamada recién agendada todavía puede decir «conversando».
      return input.upcomingCall ? "booked" : "lead";
    case "tuvo_llamada":
      return "after_call";
    default:
      return "full";
  }
};

/** Ya tuvo su llamada gratis: en vez de las reglas de persona nueva (fase 6). */
export const AFTER_CALL_RULES = `- YA TUVO SU LLAMADA GRATIS CON DAYANA (mira ESTADO DE LA PERSONA): no es una persona nueva. No la saludes como nueva, no le preguntes el país ni su nombre si ya se habló, no la invites a la llamada gratis ni le ofrezcas horas por tu cuenta y no le hagas preguntas para venderle: eso ya lo hizo Dayana.
- Lee el hilo y la FICHA, contesta corto lo que pregunta con los DATOS y sigue la regla de su estado. Si manda un comprobante o dice que pagó: register_payment_receipt. Si quiere otra llamada, cambiar algo con Dayana o algo de su proceso, dile que le pasas su mensaje a Dayana y escala (category=reschedule u other). Si no sabes qué decir, escala con category=unknown.
`;
