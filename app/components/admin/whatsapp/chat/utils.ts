import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";

export type ChatMessage = ChatDetail["messages"][number];
export type Attachment = ChatMessage["attachments"][number];

/** Acción sobre un chat (`POST /api/admin/whatsapp/chats/:id`). Lanza el código de error. */
export const post = async (id: string, body: Record<string, unknown>) => {
  const res = await fetch(`/api/admin/whatsapp/chats/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error ?? "error"));
  return data;
};

/** Hora del mensaje (9:41 a. m.). */
export const clockLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });

/** En la lista: la hora si es de hoy, si no el día. */
export const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? clockLabel(iso)
    : d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
};

/** Los archivos viven en el store privado: el navegador los pide por el CRM. */
export const mediaSrc = (url: string | null): string | null => {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("blob.vercel-storage.com")) {
      return `/api/admin/whatsapp/media?path=${encodeURIComponent(u.pathname.replace(/^\//, ""))}`;
    }
  } catch {
    return null;
  }
  return url;
};

export const KIND_LABEL: Record<string, string> = {
  image: "📷 Foto",
  sticker: "Sticker",
  audio: "🎤 Audio",
  video: "🎥 Video",
  document: "📄 Documento",
};

/** El tipo por lo que el archivo ES (un video mandado «como archivo» sigue siendo video). */
export const shownKind = (a: Attachment): string => {
  const mime = (a.mimeType ?? "").toLowerCase();
  if (a.kind === "sticker") return "sticker";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return a.kind;
};

export const initials = (name: string) =>
  name
    .replace(/^\+/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Enlaces que conviene ver como botón: Meet, pago, WhatsApp, calendario. */
export const linkKind = (url: string): string | null => {
  if (/meet\.google\.com\//.test(url)) return "🎥 Abrir Meet";
  if (/\/pagar\//.test(url)) return "💳 Enlace de pago";
  if (/wa\.me\//.test(url)) return "💬 Abrir WhatsApp";
  if (/calendar\.google\.com\//.test(url)) return "📅 Ver en el calendario";
  return null;
};

/** Id del elemento de un mensaje en el DOM (para citar, buscar y saltar). */
export const messageDomId = (id: string) => `wa-msg-${id}`;

export const WINDOW_CLOSED_TEXT =
  "Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribir con plantilla.";
