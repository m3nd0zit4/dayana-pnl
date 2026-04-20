export const WHATSAPP_NUMBER = "+573105833188";

export const buildWhatsAppUrl = (message: string): string => {
  const digits = WHATSAPP_NUMBER.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};
