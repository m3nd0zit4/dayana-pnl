/**
 * Qué adjunto se puede borrar del store en la limpieza (`media-cleanup.ts`).
 * Puro, para poder probarlo sin base ni Blob.
 */

export type CleanupAttachment = {
  kind?: string;
  url?: string | null;
  transcript?: string;
  transcriptTries?: number;
  unavailableReason?: string;
  cleanedAt?: string;
  [key: string]: unknown;
};

/** Lo que pesa y se repite: fotos, audios y videos. Stickers (los usa la IA) y documentos, no. */
const CLEANABLE_KINDS = new Set(["image", "audio", "video"]);

/** Los intentos de transcribir que hace la recuperación antes de rendirse (`transcribe.ts`). */
const TRANSCRIPT_MAX_TRIES = 3;

/** Una copia propia de lo que llegó: `inbox/<id>.<ext>`. Lo que manda Dayana (`inbox/outbound/`) no se toca. */
export const isInboundBlobUrl = (url: string | null | undefined): url is string => {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".blob.vercel-storage.com") &&
      /^\/inbox\/[A-Za-z0-9-]+\.[a-z0-9]{2,5}$/.test(u.pathname)
    );
  } catch {
    return false;
  }
};

/**
 * Se borra si es foto, audio o video con copia propia de lo que llegó. Un
 * audio, solo si ya tiene su texto (o la recuperación ya se rindió): borrarlo
 * antes sería perder lo que dijo.
 */
export const cleanableAttachment = (a: CleanupAttachment, ctx: { hasText: boolean }): boolean => {
  if (!a.kind || !CLEANABLE_KINDS.has(a.kind) || !isInboundBlobUrl(a.url)) return false;
  if (a.kind !== "audio") return true;
  return ctx.hasText || Boolean(a.transcript?.trim()) || (a.transcriptTries ?? 0) >= TRANSCRIPT_MAX_TRIES;
};

/** El adjunto después de borrar su archivo: sin URL, con el motivo y la fecha; lo demás (texto, pie) queda. */
export const cleanedAttachment = (a: CleanupAttachment, now: Date): CleanupAttachment => ({
  ...a,
  url: null,
  unavailableReason: "cleaned",
  cleanedAt: now.toISOString(),
});
