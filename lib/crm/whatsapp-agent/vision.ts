import { get } from "@vercel/blob";

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

type Att = { kind?: string; url?: string | null; mimeType?: string | null };

/**
 * Las imágenes a mirar (pura): de los mensajes de la persona desde la última
 * respuesta nuestra (lo que está preguntando ahora), y si no hay, las más
 * recientes. Como mucho `MAX_IMAGES`, la última primero.
 */
export const pickImages = (messagesOldestFirst: MessageLike[]): { url: string; mimeType: string }[] => {
  const images: { url: string; mimeType: string }[] = [];
  for (let i = messagesOldestFirst.length - 1; i >= 0 && images.length < MAX_IMAGES; i--) {
    const m = messagesOldestFirst[i];
    if (m.direction !== "INBOUND" || m.kind === "system") continue;
    const list = Array.isArray(m.attachments) ? (m.attachments as Att[]) : [];
    for (const a of list) {
      const mime = (a.mimeType ?? "").split(";")[0].trim();
      if (!a.url || !mime.startsWith("image/")) continue;
      if (a.kind !== "image" && a.kind !== "sticker") continue;
      images.push({ url: a.url, mimeType: mime });
      if (images.length >= MAX_IMAGES) break;
    }
  }
  return images;
};

/** Baja las imágenes del store privado. Las que fallan o pesan mucho se omiten. */
export const loadImages = async (
  picks: { url: string; mimeType: string }[]
): Promise<{ data: Uint8Array; mediaType: string }[]> => {
  const out: { data: Uint8Array; mediaType: string }[] = [];
  for (const p of picks) {
    try {
      const pathname = new URL(p.url).pathname.replace(/^\//, "");
      const res = await get(pathname, { access: "private" });
      if (!res || res.statusCode !== 200 || !res.stream) continue;
      const bytes = new Uint8Array(await new Response(res.stream).arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) continue;
      out.push({ data: bytes, mediaType: p.mimeType });
    } catch (e) {
      console.warn("[whatsapp-agent] no se pudo leer una imagen para la IA", e);
    }
  }
  return out;
};
