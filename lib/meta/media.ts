import { get, put } from "@vercel/blob";
import { isBlobConfigured } from "@/lib/storage/blob";
import {
  graphFetchMedia,
  graphGet,
  type MetaCredentials,
} from "./client";
import type { NormalizedAttachment } from "./inbound";

/**
 * Baja del store privado los bytes de un adjunto saliente ya subido por
 * `POST /api/admin/inbox/upload`. Contraparte de `rehostAttachment`: esa
 * función baja de Meta y sube a Blob; esta baja de Blob para mandarlo a
 * Meta — el store nunca es público, así que no hay `link`/`payload.url`
 * posible en ningún sentido.
 */
export const readOutboundAttachmentBytes = async (
  url: string
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> => {
  const result = await get(url, { access: "private" });
  if (!result || result.stream === null) return null;
  const buffer = await new Response(result.stream).arrayBuffer();
  return { buffer, contentType: result.blob.contentType ?? "application/octet-stream" };
};

export type StoredAttachment = {
  kind: string;
  url: string | null;
  mimeType: string | null;
  caption: string | null;
  /** Por qué no hay URL, cuando la rehospedación no fue posible. */
  unavailableReason?: string;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "application/pdf": "pdf",
};

const extensionFor = (mimeType: string): string =>
  EXTENSION_BY_MIME[mimeType.split(";")[0].trim()] ?? "bin";

/**
 * Resuelve la URL temporal de un medio de WhatsApp a partir de su id.
 *
 * WhatsApp no manda la URL en el webhook, solo un id; hay que pedirla y usarla
 * enseguida porque caduca a los pocos minutos.
 */
const resolveWhatsAppMediaUrl = async (
  mediaId: string,
  credentials: Pick<MetaCredentials, "token">
): Promise<{ url: string; mimeType: string | null } | null> => {
  try {
    const media = await graphGet<{ url?: string; mime_type?: string }>(
      mediaId,
      {},
      credentials
    );
    return media.url
      ? { url: media.url, mimeType: media.mime_type ?? null }
      : null;
  } catch (e) {
    console.warn("[meta] media url lookup failed", mediaId, e);
    return null;
  }
};

/**
 * Baja un adjunto de Meta y lo rehospeda en Blob.
 *
 * Las URLs de Meta caducan (minutos en WhatsApp, más en Messenger, pero
 * caducan), así que guardarlas tal cual produce hilos que se ven bien hoy y
 * salen rotos la semana que viene. Si Blob no está configurado se guarda el
 * mensaje sin adjunto y con el motivo, en vez de perder el mensaje entero.
 */
export const rehostAttachment = async (
  attachment: NormalizedAttachment,
  credentials: Pick<MetaCredentials, "token">
): Promise<StoredAttachment> => {
  const base: StoredAttachment = {
    kind: attachment.kind,
    url: null,
    mimeType: attachment.mimeType ?? null,
    caption: attachment.caption ?? null,
  };

  if (!isBlobConfigured()) {
    return { ...base, unavailableReason: "blob_not_configured" };
  }

  let sourceUrl = attachment.url ?? null;
  let mimeType = attachment.mimeType ?? null;

  if (!sourceUrl && attachment.mediaId) {
    const resolved = await resolveWhatsAppMediaUrl(
      attachment.mediaId,
      credentials
    );
    if (resolved) {
      sourceUrl = resolved.url;
      mimeType = mimeType ?? resolved.mimeType;
    }
  }

  if (!sourceUrl) {
    return { ...base, unavailableReason: "no_source_url" };
  }

  const downloaded = await graphFetchMedia(sourceUrl, credentials);
  if (!downloaded) {
    return { ...base, unavailableReason: "download_failed" };
  }

  const contentType = mimeType ?? downloaded.contentType;

  try {
    const blob = await put(
      `inbox/${crypto.randomUUID()}.${extensionFor(contentType)}`,
      downloaded.buffer,
      { access: "public", contentType, addRandomSuffix: false }
    );
    return { ...base, url: blob.url, mimeType: contentType };
  } catch (e) {
    console.warn("[meta] blob upload failed", e);
    return { ...base, unavailableReason: "upload_failed" };
  }
};
