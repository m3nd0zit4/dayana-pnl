import {
  siFacebook,
  siGoogle,
  siGooglegemini,
  siInstagram,
  siMeta,
  siNeon,
  siPaypal,
  siResend,
  siTiktok,
  siUpstash,
  siWhatsapp,
} from "simple-icons";
import { Mail, MessageSquare, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Identidad visual por integración: la marca real cuando existe en
 * `simple-icons` (CC0, sin llamada de red — los `path` vienen embebidos en el
 * paquete), y un ícono genérico de lucide con el color de marca cuando no.
 *
 * `kind: "icon"` cubre el caso `simple-icons`. `kind: "lucide"` es la
 * aproximación: mismo color de marca, forma genérica. `kind: "image"` es
 * para Mercado Pago, cuyo kit oficial es un wordmark horizontal en
 * `public/logos/mercadopago/`, no un ícono cuadrado.
 */
export type BrandVisual =
  | { kind: "icon"; hex: string; path: string; title: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: "lucide"; hex: string; title: string; Icon: LucideIcon };

/**
 * Marcas reales de `simple-icons` para las filas cuyo id no depende de nada
 * más (a diferencia de "email", que se resuelve aparte según el proveedor
 * activo). `redis` usa el ícono de Upstash porque es quien lo aloja, no
 * Redis Labs; `database` usa el de Neon por lo mismo; `agent` usa Gemini
 * porque es el modelo que corre detrás del asistente (`GEMINI_API_KEY`).
 */
const BRAND_BY_ID: Record<string, BrandVisual> = {
  whatsapp: { kind: "icon", hex: siWhatsapp.hex, path: siWhatsapp.path, title: siWhatsapp.title },
  redis: { kind: "icon", hex: siUpstash.hex, path: siUpstash.path, title: siUpstash.title },
  database: { kind: "icon", hex: siNeon.hex, path: siNeon.path, title: siNeon.title },
  agent: {
    kind: "icon",
    hex: siGooglegemini.hex,
    path: siGooglegemini.path,
    title: siGooglegemini.title,
  },
  google: { kind: "icon", hex: siGoogle.hex, path: siGoogle.path, title: siGoogle.title },
  paypal: { kind: "icon", hex: siPaypal.hex, path: siPaypal.path, title: siPaypal.title },
  mercadopago: {
    kind: "image",
    src: "/logos/mercadopago/horizontal-color.svg",
    alt: "Mercado Pago",
  },
  // La conexión Meta agrupa WhatsApp/Facebook/Instagram bajo una sola cuenta
  // OAuth: se identifica con la marca Meta. La fila de la Página individual
  // (`SOCIAL_PROVIDER_BRAND.FACEBOOK`, más abajo) sí usa la marca Facebook.
  meta: { kind: "icon", hex: siMeta.hex, path: siMeta.path, title: siMeta.title },
  tiktok: { kind: "icon", hex: siTiktok.hex, path: siTiktok.path, title: siTiktok.title },
  // Twilio e Inngest no tienen marca en simple-icons todavía: ícono genérico
  // de lucide con el color de marca real (Twilio "Signal Red"; el de Inngest
  // es una aproximación visual, no hay hex oficial publicado que se pudiera
  // verificar).
  sms: { kind: "lucide", hex: "F22F46", title: "Twilio", Icon: MessageSquare },
  inngest: { kind: "lucide", hex: "6366F1", title: "Inngest", Icon: Workflow },
};

/** Gris neutro para lo que de verdad no tiene una sola marca que representarlo. */
const NEUTRAL_HEX = "94a3b8";

export const getIntegrationBrand = (item: {
  id: string;
  requiredEnv: readonly string[];
}): BrandVisual => {
  if (item.id === "email") {
    // SMTP es un protocolo, no una marca: un sobre genérico es lo honesto.
    // Resend sí es una marca concreta, así que se gana su ícono real.
    return item.requiredEnv.includes("RESEND_API_KEY")
      ? { kind: "icon", hex: siResend.hex, path: siResend.path, title: siResend.title }
      : { kind: "lucide", hex: NEUTRAL_HEX, title: "SMTP", Icon: Mail };
  }

  return (
    BRAND_BY_ID[item.id] ??
    // No debería pasar: cubre cualquier id fuera de IntegrationId conocido.
    { kind: "lucide", hex: NEUTRAL_HEX, title: item.id, Icon: Mail }
  );
};

/**
 * Identidad de cada proveedor social a nivel de cuenta conectada (la fila
 * dentro de una `Card` en `SocialConnectionsClient`), distinta de la marca
 * de la conexión OAuth en `BRAND_BY_ID.meta` — ver comentario ahí arriba.
 */
export const SOCIAL_PROVIDER_BRAND: Record<"FACEBOOK" | "INSTAGRAM" | "TIKTOK", BrandVisual> = {
  FACEBOOK: { kind: "icon", hex: siFacebook.hex, path: siFacebook.path, title: siFacebook.title },
  INSTAGRAM: {
    kind: "icon",
    hex: siInstagram.hex,
    path: siInstagram.path,
    title: siInstagram.title,
  },
  TIKTOK: { kind: "icon", hex: siTiktok.hex, path: siTiktok.path, title: siTiktok.title },
};

export const SimpleIconGlyph = ({
  visual,
  className,
}: {
  visual: BrandVisual;
  className?: string;
}) => {
  if (visual.kind === "image") {
    // Wordmark horizontal, no un ícono cuadrado: el alto manda y el ancho se
    // ajusta solo, así que cualquier `size-*`/`w-*` que traiga `className` se
    // descarta a propósito.
    return (
      // eslint-disable-next-line @next/next/no-img-element -- asset local, no necesita remotePattern
      <img src={visual.src} alt={visual.alt} className={cn(className, "h-4 w-auto")} />
    );
  }
  if (visual.kind === "lucide") {
    const Icon = visual.Icon;
    return (
      <Icon
        aria-label={visual.title}
        className={className}
        style={{ color: `#${visual.hex}` }}
      />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={visual.title}
      className={className}
      style={{ color: `#${visual.hex}` }}
    >
      <path d={visual.path} fill="currentColor" />
    </svg>
  );
};
