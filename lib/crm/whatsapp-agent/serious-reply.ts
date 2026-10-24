import { foldForSearch } from "../search-normalize";
import type { ChatPaymentLink } from "./chat-payment-link";

/**
 * La asistente nunca deja de responder (dueño, 21-oct): lo que antes callaba a
 * la IA o le decía «Déjame consultarlo con Dayana» (algo clínico, alguien que
 * ya tuvo su llamada y sigue pidiendo) ahora recibe una respuesta, y Dayana un
 * aviso que la persona no ve. Joselyn llevaba 6 días sin respuesta.
 *
 * Nunca líneas de emergencia ni «urgente» (dueña, 24-oct: «es para ventas y
 * cierres»; Francy contó que la llamada se cortó y recibió el mensaje de
 * emergencias): si cuenta algo de su vida, por duro que sea, una frase de apoyo
 * y el siguiente paso.
 * - Ya tuvo su llamada gratis: el paso es el pago, cada vez más directo si
 *   insiste (dueño: «muchas personas ya están en sus sesiones… si no da el
 *   paso, no se está ayudando»).
 * - Antes de la llamada: la invitación a la llamada gratis, o la que ya tiene.
 *
 * Puro: `brain.ts` decide cuándo y pega el enlace.
 */

/** Lo que marca que ya se le dijo el paso del pago (la escalera sube con cada vez). */
export const PAY_MARKER = "el siguiente paso es el pago";
const DIRECT_MARKER = "te lo digo de forma directa";
const ASK_HOW = "¿Prefieres que te mande el enlace de pago o los datos para transferencia?";

export type SeriousInput = {
  stage: string | null;
  /** El enlace de pago que le mandó Dayana (el que dice su nota), si hay. */
  link: ChatPaymentLink | null;
  /** Dayana le mandó los datos para pagar (cuenta, Nequi, Western Union) y no un enlace (Raquel). */
  hasPaymentData: boolean;
  /** Lo que la asistente le escribió antes (del más viejo al más nuevo). */
  priorAi: string[];
  /** Se le puede ofrecer la llamada gratis (flujo de venta, aún no la tuvo). */
  canOfferFreeCall: boolean;
  /** Su llamada gratis agendada, si la tiene («jueves, 29 de octubre, 3:00 p. m.»). */
  upcomingLabel: string | null;
};

const said = (prior: string[], marker: string) => prior.filter((t) => foldForSearch(t).includes(foldForSearch(marker))).length;

const payLadder = (input: SeriousInput): string => {
  const what = input.link && input.link.label !== "enlace de pago" ? ` del ${input.link.label}` : "";
  const done = " Cuando lo hagas, me mandas el comprobante por aquí y Dayana te agenda.";
  const how = input.link
    ? ` por el enlace que te envió Dayana.${done}`
    : input.hasPaymentData
      ? ` con los datos que te envió Dayana.${done}`
      : `. ${ASK_HOW}`;
  const times = said(input.priorAi, PAY_MARKER);
  if (times === 0) {
    return `Te entiendo. Tu llamada gratis con Dayana ya la tuviste: para trabajarlo con ella (otra llamada, una consulta o tu proceso), ${PAY_MARKER}${what}${how}`;
  }
  if (said(input.priorAi, DIRECT_MARKER) === 0) {
    return `Te lo digo de forma directa: muchas personas ya están trabajando su proceso con Dayana en sesiones personalizadas, y empezaron dando el paso del pago. Por aquí no puedo darte acompañamiento: eso lo trabajas con Dayana en tus sesiones, y ahí ella define contigo cuánto tiempo necesitas. Si no das el paso, nada va a cambiar. El siguiente paso es el pago${what}${how}`;
  }
  return `Como te dije, ${PAY_MARKER}${what}${how}`;
};

export const seriousReply = (input: SeriousInput): { text: string; attachLink: boolean } => {
  if (input.stage === "tuvo_llamada") return { text: payLadder(input), attachLink: Boolean(input.link) };
  if (input.upcomingLabel) {
    return {
      text: `Te entiendo. En tu llamada gratis con Dayana (${input.upcomingLabel}) puedes contarle todo esto: ella te escucha y te dice cómo te puede ayudar.`,
      attachLink: false,
    };
  }
  if (input.canOfferFreeCall) {
    return {
      text: "Te entiendo. Lo que sientes es justo lo que Dayana trabaja. Si quieres, te agendo una llamada gratis de 15 minutos con ella para que te escuche y te diga cómo te puede ayudar.",
      attachLink: false,
    };
  }
  return { text: "Te entiendo. Lo que me cuentas es justo lo que Dayana trabaja en sus sesiones personalizadas.", attachLink: false };
};

/**
 * Pide otra llamada, una consulta, una sesión, algo gratis o ayuda con lo que
 * siente. Un enlace que no abre, una factura o una pregunta del servicio no:
 * eso sigue siendo de Dayana (revisión 21-oct).
 */
const MORE_HELP =
  /\b(llamada|llamar|llamame|llamen|consulta|sesion|sesiones|gratis|gratuit[oa]|ayuda|ayudame|ayudeme|quitame|quiteme|angustia|miedos?|ansiedad|tristeza|agendar|reagendar|agendame|cita|hablar con (dayana|ella)|acompanamiento)\b/;
export const asksForMoreHelp = (texts: string[]): boolean => texts.some((t) => MORE_HELP.test(foldForSearch(t)));
