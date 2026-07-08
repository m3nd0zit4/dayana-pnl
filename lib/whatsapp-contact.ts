/** Enlace directo al chat de WhatsApp de un contacto (E.164). */
export const buildContactWhatsAppUrl = (
  phoneE164: string,
  message?: string
): string | null => {
  // Solo E.164 real: un placeholder tipo "+google:<uuid>" contiene dígitos
  // sueltos que armarían un wa.me hacia un número basura.
  if (!/^\+\d{8,15}$/.test(phoneE164)) return null;
  const base = `https://wa.me/${phoneE164.slice(1)}`;
  if (!message?.trim()) return base;
  return `${base}?text=${encodeURIComponent(message.trim())}`;
};
