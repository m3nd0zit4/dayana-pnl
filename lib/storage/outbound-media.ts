import { put } from "@vercel/blob";

/**
 * Adjuntos salientes de los chats en el store privado de Blob: la bandeja al
 * adjuntar (`POST /api/admin/inbox/upload`) y la copia de la imagen de un
 * envío masivo. Viven en `inbox/outbound/`, lo único (junto a lo entrante)
 * que `GET /api/admin/whatsapp/media` sirve al chat.
 *
 * Sin `next/server` a propósito (a diferencia de `./blob.ts`): este archivo
 * no debe arrastrar nada que el build de eve no sepa resolver.
 */

const OUTBOUND_PATH_RE = /^\/inbox\/outbound\/[A-Za-z0-9-]+\.[a-z0-9]{2,5}$/;

/** Guarda el archivo con un nombre único que nunca se reescribe y devuelve su URL. */
export const putOutboundMedia = async (
  body: File | Blob | ArrayBuffer,
  mimeType: string,
  extension: string
): Promise<string> => {
  const blob = await put(`inbox/outbound/${crypto.randomUUID()}.${extension}`, body, {
    access: "private",
    contentType: mimeType,
    addRandomSuffix: false,
  });
  return blob.url;
};

/** Una URL de `putOutboundMedia` (y no cualquier enlace que llegue en una petición). */
export const isOutboundMediaUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".blob.vercel-storage.com") &&
      OUTBOUND_PATH_RE.test(url.pathname)
    );
  } catch {
    return false;
  }
};
