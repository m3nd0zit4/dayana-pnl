import { foldForSearch } from "../search-normalize";

/**
 * ¿Dayana le confirmó el pago a la persona desde el celular? Con un
 * comprobante por confirmar en el chat, su «Mi hermosa, te bendigo, he
 * recibido, muchísimas gracias» (nota de voz, 15-oct-2026) es la
 * confirmación: antes el CRM seguía pidiéndole que lo confirmara.
 *
 * Solo se usa con un comprobante pendiente y para lo que ella escribe después
 * (fuera de ese contexto «recibido» puede ser cualquier cosa). Puro.
 */

const ACK = [
  /\b(he|ya) recibido\b/,
  /\brecibid[oa]s?\b/,
  /\b(ya )?(lo|la|te lo|te la) recibi\b/,
  /\brecibi (tu|el|la|su) (pago|comprobante|transferencia|deposito|dinero|giro)\b/,
  /\b(ya )?me llego\b/,
  /\bya llego\b/,
  /\bllego (bien|perfecto|completo)\b/,
  /\b(pago )?confirmad[oa]\b/,
];

/** «no me ha llegado», «aún no lo recibo», «todavía no se confirma». */
const NEGATED = /\b(no|aun no|todavia no|nada)\b[^.?!]{0,25}\b(recib|lleg|confirm)/;
/** El mensaje de ausencia o de bienvenida del celular: «tu mensaje fue recibido». */
const AUTOMATIC = /\bmensaje (fue |ha sido )?recibido\b/;

export const isPaymentAck = (text: string | null | undefined): boolean => {
  if (!text?.trim()) return false;
  const folded = foldForSearch(text.replace(/^🎤\s*/u, ""));
  if (NEGATED.test(folded) || AUTOMATIC.test(folded)) return false;
  // Una pregunta («¿ya me llegó?», «¿recibido?») no confirma nada.
  if (/\?\s*$/.test(text.trim())) return false;
  return ACK.some((re) => re.test(folded));
};
