/**
 * Ayudas puras del chat de WhatsApp del CRM (sin React, sin base de datos):
 * separadores de fecha, búsqueda dentro del chat, nombres de archivo y las
 * reacciones rápidas. Viven aquí para poder probarlas sin navegador.
 */

/** Los seis de la barra rápida de WhatsApp. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Días de calendario (hora local) entre `date` y `now`: 0 hoy, 1 ayer… */
export const calendarDaysAgo = (date: Date, now: Date): number =>
  Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);

/** ¿Caen el mismo día (hora local)? */
export const sameDay = (a: Date | string, b: Date | string): boolean => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

/**
 * La etiqueta del separador de fecha, como en WhatsApp: «Hoy», «Ayer», el día
 * de la semana en la última semana y si no «12 de septiembre» (con año si es
 * de otro año).
 */
export const dateSeparatorLabel = (value: Date | string, now: Date = new Date()): string => {
  const date = new Date(value);
  const days = calendarDaysAgo(date, now);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days > 1 && days < 7) return WEEKDAYS[date.getDay()];
  const base = `${date.getDate()} de ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} de ${date.getFullYear()}`;
};

/**
 * Minúsculas y sin tildes, carácter por carácter: el resultado mide lo mismo
 * que el original, así una coincidencia se puede resaltar en el texto real.
 */
export const foldForSearch = (text: string): string => {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const folded = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += folded.length === 1 ? folded : ch.length === 1 && ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
  }
  return out;
};

/** ¿El texto contiene la búsqueda (sin distinguir mayúsculas ni tildes)? */
export const matchesSearch = (text: string | null | undefined, query: string): boolean => {
  const q = foldForSearch(query.trim());
  if (!q || !text) return false;
  return foldForSearch(text).includes(q);
};

/** Trozos del texto para pintar: los que coinciden van marcados. */
export const highlightParts = (text: string, query: string): { text: string; match: boolean }[] => {
  const q = foldForSearch(query.trim());
  if (!q) return [{ text, match: false }];
  const folded = foldForSearch(text);
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length ? parts : [{ text, match: false }];
};

type Searchable = {
  id: string;
  body: string | null;
  kind?: string;
  attachments?: { caption: string | null }[];
};

/** Ids de los mensajes que coinciden, en el orden del chat (el más viejo primero). */
export const searchMessages = (messages: Searchable[], query: string): string[] =>
  query.trim()
    ? messages
        .filter(
          (m) =>
            matchesSearch(m.body, query) || (m.attachments ?? []).some((a) => matchesSearch(a.caption, query))
        )
        .map((m) => m.id)
    : [];

/** El siguiente índice de coincidencia al moverse con las flechas (da la vuelta). */
export const stepMatch = (current: number, total: number, dir: 1 | -1): number =>
  total === 0 ? -1 : current < 0 ? (dir === 1 ? 0 : total - 1) : (current + dir + total) % total;

const PREVIEW_KIND: Record<string, string> = {
  image: "📷 Foto",
  sticker: "Sticker",
  audio: "🎤 Audio",
  video: "🎥 Video",
  document: "📄 Documento",
};

/** Una línea para la cita: el texto del mensaje o qué tipo de archivo era. */
export const quotePreview = (m: {
  body: string | null;
  attachments: { kind: string; caption: string | null }[];
}): string => {
  const body = m.body?.trim();
  if (body) return body.length > 160 ? `${body.slice(0, 157)}…` : body;
  const a = m.attachments[0];
  if (!a) return "Mensaje";
  return a.caption?.trim() || PREVIEW_KIND[a.kind] || "📎 Archivo";
};

/** Nombre que se muestra en la ficha de un documento. */
export const documentName = (a: { url: string | null; caption: string | null; filename?: string | null }): string => {
  if (a.filename?.trim()) return a.filename.trim();
  if (a.caption?.trim()) return a.caption.trim();
  if (a.url) {
    try {
      const path = a.url.startsWith("/") ? a.url.split("?")[0] : new URL(a.url).pathname;
      const last = decodeURIComponent(path.split("/").pop() ?? "");
      if (last) return last;
    } catch {
      /* URL rara: cae al genérico */
    }
  }
  return "Documento";
};

const DOC_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "text/plain": "TXT",
  "text/csv": "CSV",
  "application/zip": "ZIP",
};

/** «PDF», «DOCX»… a partir del tipo MIME (o de la extensión del nombre). */
export const documentType = (mimeType: string | null | undefined, name?: string): string => {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (DOC_TYPES[mime]) return DOC_TYPES[mime];
  const ext = name?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (ext) return ext.toUpperCase();
  const sub = mime.split("/")[1];
  return sub ? sub.toUpperCase().slice(0, 6) : "Archivo";
};
