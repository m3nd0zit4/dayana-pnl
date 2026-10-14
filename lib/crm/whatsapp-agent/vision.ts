import { get } from "@vercel/blob";

import { fetchWhatsAppMedia, WHATSAPP_MEDIA_TTL_MS } from "@/lib/meta/media";

/**
 * Lo que la IA VE: las últimas fotos y stickers que mandó la persona, como
 * imágenes de verdad (Gemini las lee). Antes solo recibía el texto «[imagen]»
 * y tenía que adivinar si era un comprobante de pago o una foto cualquiera.
 */

export const MAX_IMAGES = 3;
const MAX_BYTES = 4 * 1024 * 1024;

type MessageLike = {
  direction: string;
  status?: string | null;
  kind?: string | null;
  attachments: unknown;
};

type Att = { kind?: string; url?: string | null; mimeType?: string | null; mediaId?: string; unavailableReason?: string };

/** Una imagen a mirar: la copia propia (Blob) o, si no se pudo guardar, su id en WhatsApp. */
export type ImagePick = { url: string | null; mediaId: string | null; mimeType: string };

/**
 * Las imágenes a mirar (pura): de los mensajes de la persona desde la última
 * respuesta nuestra (lo que está preguntando ahora), y si no hay, las más
 * recientes. Como mucho `MAX_IMAGES`, la última primero.
 */
export const pickImages = (messagesOldestFirst: (MessageLike & { sentAt?: Date })[], now = Date.now()): ImagePick[] => {
  const images: ImagePick[] = [];
  for (let i = messagesOldestFirst.length - 1; i >= 0 && images.length < MAX_IMAGES; i--) {
    const m = messagesOldestFirst[i];
    if (m.direction !== "INBOUND" || m.kind === "system") continue;
    const list = Array.isArray(m.attachments) ? (m.attachments as Att[]) : [];
    for (const a of list) {
      const mime = (a.mimeType ?? "").split(";")[0].trim();
      if (!mime.startsWith("image/")) continue;
      if (a.kind !== "image" && a.kind !== "sticker") continue;
      // Sin copia propia (Blob suspendido o falló): WhatsApp la guarda 7 días.
      const fresh = !m.sentAt || now - m.sentAt.getTime() < WHATSAPP_MEDIA_TTL_MS;
      const mediaId = !a.url && a.mediaId && fresh && a.unavailableReason !== "expired" ? a.mediaId : null;
      if (!a.url && !mediaId) continue;
      images.push({ url: a.url ?? null, mediaId, mimeType: mime });
      if (images.length >= MAX_IMAGES) break;
    }
  }
  return images;
};

/** Baja las imágenes (del store privado o de WhatsApp). Las que fallan o pesan mucho se omiten. */
export const loadImages = async (picks: ImagePick[]): Promise<{ data: Uint8Array; mediaType: string }[]> => {
  const out: { data: Uint8Array; mediaType: string }[] = [];
  for (const p of picks) {
    try {
      let bytes: Uint8Array | null = null;
      if (p.url) {
        const pathname = new URL(p.url).pathname.replace(/^\//, "");
        const res = await get(pathname, { access: "private" }).catch(() => null);
        if (res && res.statusCode === 200 && res.stream) bytes = new Uint8Array(await new Response(res.stream).arrayBuffer());
      } else if (p.mediaId) {
        const media = await fetchWhatsAppMedia(p.mediaId);
        if (media) bytes = new Uint8Array(media.buffer);
      }
      if (!bytes || bytes.byteLength > MAX_BYTES) continue;
      out.push({ data: bytes, mediaType: p.mimeType });
    } catch (e) {
      console.warn("[whatsapp-agent] no se pudo leer una imagen para la IA", e);
    }
  }
  return out;
};
