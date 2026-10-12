/**
 * El número tal como lo usa WhatsApp (su «wa_id»), que no siempre es el E.164:
 * - México: los chats llegan como 521 + 10 dígitos (el CRM guarda +52 + 10).
 * - Argentina: los celulares van con 9 después del 54.
 * Sin esto, cuando la persona responde su mensaje cae en otro chat y la
 * ventana de 24 h nunca se abre en el que creó el CRM.
 */
export const whatsAppDigits = (phoneE164: string): string => {
  const d = phoneE164.replace(/\D/g, "");
  if (d.startsWith("52") && d.length === 12) return `521${d.slice(2)}`;
  if (d.startsWith("54") && d.length === 12 && d[2] !== "9") return `549${d.slice(2)}`;
  return d;
};

/** Enlace directo al chat de WhatsApp de un contacto (E.164). */
export const buildContactWhatsAppUrl = (
  phoneE164: string,
  message?: string
): string | null => {
  // Solo E.164 real: un placeholder tipo "+google:<uuid>" contiene dígitos
  // sueltos que armarían un wa.me hacia un número basura.
  if (!/^\+\d{8,15}$/.test(phoneE164)) return null;
  const base = `https://wa.me/${whatsAppDigits(phoneE164)}`;
  if (!message?.trim()) return base;
  return `${base}?text=${encodeURIComponent(message.trim())}`;
};

/**
 * Id de WhatsApp de quien escribe con nombre de usuario, sin mostrar su
 * número (BSUID): país, punto y el id, p. ej. «PE.2290670648352185».
 */
export const isWhatsAppUserId = (threadId: string): boolean => /^[A-Z]{2}\.[A-Za-z0-9.]+$/.test(threadId);

/** A quién va un mensaje: `recipient` para ids de usuario, `to` para números. */
export const whatsAppRecipient = (
  threadId: string,
  toDigits: (v: string) => string = (v) => v.replace(/\D/g, "")
): { to: string } | { recipient: string } =>
  isWhatsAppUserId(threadId) ? { recipient: threadId } : { to: toDigits(threadId) };

/**
 * Las formas en que el mismo número puede ser el id de un chat (en dígitos,
 * la tal cual primero). WhatsApp no siempre usa el E.164:
 * - México: 52 + 10 ↔ 521 + 10.
 * - Argentina: 54 + 10 ↔ 549 + 10 (el 9 de los celulares).
 * - Brasil: los celulares viejos pueden tener el id sin el 9 después del DDD
 *   (55 + DDD + 8 ↔ 55 + DDD + 9 + 8). Solo celulares (empiezan en 6–9): un
 *   fijo con un 9 delante sería el número de otra persona.
 * Un id de usuario (BSUID, «PE.2290…») no tiene variantes.
 *
 * Sirve para ENCONTRAR el chat que ya existe; para enviar se usa
 * {@link whatsAppDigits}.
 */
export const whatsAppIdVariants = (threadId: string): string[] => {
  if (isWhatsAppUserId(threadId)) return [threadId];
  const d = threadId.replace(/\D/g, "");
  if (!d) return [];
  const out = [d];
  if (d.length === 13 && (d.startsWith("521") || d.startsWith("549"))) out.push(`${d.slice(0, 2)}${d.slice(3)}`);
  if (d.length === 12 && (d.startsWith("52") || d.startsWith("54"))) {
    out.push(`${d.slice(0, 2)}${d.startsWith("52") ? "1" : "9"}${d.slice(2)}`);
  }
  if (d.startsWith("55")) {
    if (d.length === 13 && d[4] === "9" && /[6-9]/.test(d[5])) out.push(`${d.slice(0, 4)}${d.slice(5)}`);
    if (d.length === 12 && /[6-9]/.test(d[4])) out.push(`${d.slice(0, 4)}9${d.slice(4)}`);
  }
  return out;
};

/** +521… ↔ +52…, +549… ↔ +54…, Brasil con y sin 9: las formas en que puede estar guardado el contacto. */
export const contactPhoneCandidates = (threadId: string): string[] =>
  isWhatsAppUserId(threadId) ? [] : whatsAppIdVariants(threadId).map((d) => `+${d}`);
