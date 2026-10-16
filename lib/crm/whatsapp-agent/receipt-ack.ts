import { foldForSearch } from "../search-normalize";

/**
 * ¿Dayana le confirmó el pago a la persona desde el celular? Con un
 * comprobante por confirmar en el chat, su «Mi hermosa, te bendigo, he
 * recibido, muchísimas gracias» (nota de voz, 15-oct-2026) es la
 * confirmación: antes el CRM seguía pidiéndole que lo confirmara.
 *
 * Solo se usa con un comprobante pendiente y para lo que ella escribe después
 * (fuera de ese contexto «recibido» puede ser cualquier cosa). Recibir la
 * foto no es recibir el dinero: «recibí el comprobante, lo reviso» no cuenta.
 * Puro.
 */

const ACK = [
  /\b(he|ya) recibido\b/,
  /\brecibid[oa]s?\b/,
  /\b(ya )?(lo|la|te lo|te la) recibi\b/,
  /\brecibi (tu|el|la|su) (pago|transferencia|deposito|dinero|giro)\b/,
  /\b(ya )?me llego\b/,
  /\bya llego\b/,
  /\bllego (bien|perfecto|completo)\b/,
  /\b(pago )?confirmad[oa]\b/,
];

/** «no me ha llegado», «aún no lo he recibido», «todavía no llega» (y no «no te preocupes, ya lo recibí»). */
const NEGATED = /\b(no|aun no|todavia no)\s+(me |te |le |se )?(lo |la )?(he |ha |han |has |hemos )?(recib|lleg|confirm)/;
/** Recibió la foto y todavía lo va a mirar, o el aviso de recibido de la propia asistente. */
const PENDING = /\b(lo|la) (reviso|reviso y|verifico|confirmo|reviso luego|veo)\b|\b(te|le) (confirmo|aviso)\b|\b(voy a|dejame|deja que|para que lo) (revis|verific|confirm)|\blo revise\b|\ben cuanto (lo )?(revise|verifique|confirme|me llegue)\b/;
/** El mensaje de ausencia o de bienvenida del celular: «tu mensaje fue recibido». */
const AUTOMATIC = /\bmensaje (fue |ha sido )?recibido\b/;

export const isPaymentAck = (text: string | null | undefined): boolean => {
  if (!text?.trim()) return false;
  const folded = foldForSearch(text.replace(/^🎤\s*/u, ""));
  if (NEGATED.test(folded) || PENDING.test(folded) || AUTOMATIC.test(folded)) return false;
  // Una pregunta («¿ya me llegó?», «¿recibido?») no confirma nada.
  if (/\?\s*$/.test(text.trim())) return false;
  return ACK.some((re) => re.test(folded));
};
