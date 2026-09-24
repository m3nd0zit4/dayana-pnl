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
