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
  youtube: "https://www.youtube.com/@dayanabeltranpnl",
  // Página real de Dayana, creada desde su propia cuenta y enlazada con
  // @dayana.pnl. La anterior (id 1244614882070058) era un duplicado creado por
  // error desde otra cuenta y ya está eliminada: cualquier enlace a ese id
  // lleva a una página que no existe.
  //
  // URL por id porque la página todavía no tiene nombre de usuario. Cuando se
  // le asigne uno conviene cambiarla aquí para que `sameAs` use la forma corta.
  facebook: "https://www.facebook.com/profile.php?id=61592657888164",
  email: "mailto:contacto@dayanabeltran.com",
} as const;

export type SocialKey = keyof typeof SOCIAL_LINKS;
