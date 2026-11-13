import { foldForSearch } from "../search-normalize";

/**
 * La asistente nunca deja de responder (dueño, 21-oct): lo que antes callaba a
 * la IA o le decía «Déjame consultarlo con Dayana» (algo clínico) ahora recibe
 * una respuesta, y Dayana un aviso que la persona no ve. Joselyn llevaba 6 días
 * sin respuesta.
 *
 * Nunca líneas de emergencia ni «urgente» (dueña, 24-oct: «es para ventas y
 * cierres»; Francy contó que la llamada se cortó y recibió el mensaje de
 * emergencias): si cuenta algo de su vida, por duro que sea, una frase de apoyo
 * y el siguiente paso: antes de la llamada, la invitación a la llamada gratis
 * o la que ya tiene. Después de su llamada, solo la frase de apoyo: ni otra
 * llamada ni pagos (dueña, 13-nov; Dayana recibe el aviso).
 *
 * Puro: `brain.ts` decide cuándo.
 */

export type SeriousInput = {
  /** Se le puede ofrecer la llamada gratis (flujo de venta, aún no la tuvo). */
  canOfferFreeCall: boolean;
  /** Su llamada gratis agendada, si la tiene («jueves, 29 de octubre, 3:00 p. m.»). */
  upcomingLabel: string | null;
};

export const seriousReply = (input: SeriousInput): string => {
  if (input.upcomingLabel) {
    return `Te entiendo. En tu llamada gratis con Dayana (${input.upcomingLabel}) puedes contarle todo esto: ella te escucha y te dice cómo te puede ayudar.`;
  }
  if (input.canOfferFreeCall) {
    return "Te entiendo. Lo que sientes es justo lo que Dayana trabaja. Si quieres, te agendo una llamada gratis de 15 minutos con ella para que te escuche y te diga cómo te puede ayudar.";
  }
  return "Te entiendo. Lo que me cuentas es justo lo que Dayana trabaja en sus sesiones personalizadas.";
};

/**
 * Pide otra llamada o reagendar con Dayana (dueña, 12-nov: «las personas que ya
 * tuvieron una llamada… quiero que sí sea posible»): queda como pedido que
 * Dayana aprueba.
 */
const WANTS_CALL =
  /\b(reagendar\w*|agendame|agendarme|otra (llamada|cita)|cambiar (la|mi) (llamada|cita)|mover (la|mi) (llamada|cita)|(quiero|quisiera|puedo|podemos|podria|podriamos|necesito|me (puedes|podrias|das)|se puede)\b[^.?!]{0,30}\b(llamada|cita|agendar|hablar con (dayana|ella)))\b/;
export const asksForCall = (texts: string[]): boolean => texts.some((t) => WANTS_CALL.test(foldForSearch(t)));
