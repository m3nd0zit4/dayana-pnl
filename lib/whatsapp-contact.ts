/** Enlace directo al chat de WhatsApp de un contacto (E.164). */
export const buildContactWhatsAppUrl = (
  phoneE164: string,
  message?: string
): string | null => {
  const digits = phoneE164.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const base = `https://wa.me/${digits}`;
  if (!message?.trim()) return base;
  return `${base}?text=${encodeURIComponent(message.trim())}`;
};
