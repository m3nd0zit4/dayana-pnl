import { put } from "@vercel/blob";
import { isBlobConfigured } from "@/lib/storage/blob";
import {
  graphFetchMedia,
  graphGet,
  type MetaCredentials,
} from "./client";
import type { NormalizedAttachment } from "./inbound";
import { resolveWhatsAppCredentials } from "./whatsapp-provider";

export type StoredAttachment = {
  kind: string;
  url: string | null;
  mimeType: string | null;
  caption: string | null;
  /** Por qué no hay URL, cuando la rehospedación no fue posible. */
  unavailableReason?: string;
  /** Huella del archivo: el mismo sticker enviado dos veces tiene la misma. */
  sha256?: string;
  /** Id del medio en WhatsApp (sirve para reintentar la descarga un tiempo). */
  mediaId?: string;
  /** Lo que dice una nota de voz, transcrito al recibirla. */
  transcript?: string;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "video/3gpp": "3gp",
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
    ...(attachment.mediaId ? { mediaId: attachment.mediaId } : {}),
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

  // Una nota de voz se transcribe ya, ANTES de guardarla: la IA contesta y
  // aprende del texto, y el texto no depende de que Blob acepte el archivo
  // (con el store suspendido, ningún audio tenía texto).
  let transcript: string | undefined;
  if (attachment.kind === "audio") {
    const { transcribeAudio } = await import("@/lib/crm/whatsapp-agent/transcribe");
    transcript =
      (await transcribeAudio(downloaded.buffer, contentType).catch((e) => {
        console.warn("[meta] no se pudo transcribir un audio", e);
        return null;
      })) ?? undefined;
  }
  const digest = await crypto.subtle.digest("SHA-256", downloaded.buffer);
  const sha256 = Buffer.from(digest).toString("hex");

  try {
    // El store de Blob es privado: con `access: "public"` cada adjunto fallaba
    // («upload_failed») y en el CRM no se veía ni una foto ni un audio. Se
    // guarda privado y el CRM lo pide por `/api/admin/whatsapp/media`, con
    // sesión de staff.
    const blob = await put(
      `inbox/${crypto.randomUUID()}.${extensionFor(contentType)}`,
      downloaded.buffer,
      { access: "private", contentType, addRandomSuffix: false }
    );
    return { ...base, url: blob.url, mimeType: contentType, sha256, ...(transcript ? { transcript } : {}) };
  } catch (e) {
    // Sin copia propia, el archivo se sigue viendo 7 días pidiéndolo a
    // WhatsApp por su id (`/api/admin/whatsapp/media?mediaId=`).
    console.warn("[meta] blob upload failed", e);
    return { ...base, mimeType: contentType, sha256, unavailableReason: "upload_failed", ...(transcript ? { transcript } : {}) };
  }
};

/** WhatsApp guarda cada archivo 7 días; un poco menos para no pedir lo vencido. */
export const WHATSAPP_MEDIA_TTL_MS = 6.5 * 24 * 3600_000;

/**
 * Baja un archivo directo de WhatsApp por su id, sin pasar por Blob: sirve
 * para ver, oír y transcribir lo que no se pudo guardar (store suspendido,
 * descarga fallida) mientras WhatsApp lo conserve. Null si no se pudo.
 */
export const fetchWhatsAppMedia = async (
  mediaId: string
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> => {
  if (!/^\d{5,40}$/.test(mediaId)) return null;
  const credentials = await resolveWhatsAppCredentials().catch(() => null);
  if (!credentials) return null;
  const resolved = await resolveWhatsAppMediaUrl(mediaId, credentials);
  if (!resolved) return null;
  const downloaded = await graphFetchMedia(resolved.url, credentials);
  if (!downloaded) return null;
  return { buffer: downloaded.buffer, contentType: resolved.mimeType ?? downloaded.contentType };
};
