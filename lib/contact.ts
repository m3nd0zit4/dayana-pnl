export const BRAND = {
  name: "Dayana Beltrán",
  tagline: "Maestra en Programación Neurolingüística",
  shortName: "Dayana Beltrán PNL",
  startedYear: 2024,
};

export const WHATSAPP_NUMBER = "+573105833188";

export const WHATSAPP_COMMUNITY_URL = "https://chat.whatsapp.com/GXPARCB8Ur0Fd0I78g2eYl";

export const buildWhatsAppUrl = (message: string): string => {
  const digits = WHATSAPP_NUMBER.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

export const SOCIAL_LINKS = {
  tiktok: "https://www.tiktok.com/@dayanapnl",
  instagram: "https://www.instagram.com/dayana.pnl",
  youtube: "https://www.youtube.com/@dianabeltranpnl",
  email: "mailto:contacto@dayanabeltran.com",
} as const;

export type SocialKey = keyof typeof SOCIAL_LINKS;
