import { createHash } from "node:crypto";

import { zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { whatsAppDigits } from "@/lib/whatsapp-contact";
import { parseWhatsAppExport } from "./whatsapp-reply-pairs";
import { foldForSearch } from "./search-normalize";

/**
 * Chats exportados desde el celular de Dayana (WhatsApp → chat → Más →
 * Exportar chat → «Sin archivos») convertidos en chats de verdad del CRM.
 *
 * Puro (sin Prisma, sin red): lee el .txt, adivina quién es quién y arma los
 * mismos eventos de historial que trae la sincronización de coexistencia, para
 * que pasen por `processHistoryEvents` como cualquier otro historial.
 */

export type ExportChatMessage = {
  sentAt: Date;
  author: string;
  /** null = adjunto no incluido o mensaje borrado. */
  body: string | null;
  /** WhatsApp dejó un «<Multimedia omitido>» en lugar del archivo. */
  media: boolean;
};

export type ParsedExportFile = {
  contactName: string;
  /** Número sacado del nombre del archivo o del autor, en E.164. */
  phoneFromName: string | null;
  messages: ExportChatMessage[];
  /** Quién escribe, del que más al que menos mensajes tiene. */
  authors: string[];
};

/** Marcas invisibles que el exportador mete en nombres y textos. */
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** El archivo tal como lo nombra WhatsApp en español, inglés o portugués. */
const FILE_NAME_PATTERNS = [
  /^chat de whatsapp con\s+(.+)$/i,
  /^whatsapp chat with\s+(.+)$/i,
  /^whatsapp chat\s*-\s*(.+)$/i,
  /^chat de whatsapp\s*-\s*(.+)$/i,
  /^conversa do whatsapp com\s+(.+)$/i,
];

const baseName = (fileName: string) =>
  (fileName.split(/[\\/]/).pop() ?? fileName)
    .replace(INVISIBLE, "")
    .replace(/\.(txt|zip)$/i, "")
    // «Chat de WhatsApp con Laura (1)» cuando el archivo se bajó dos veces.
    .replace(/\s*\(\d+\)$/, "")
    .trim();

/** Nombre del contacto según el archivo («Chat de WhatsApp con Laura Pérez.txt»). */
export const contactNameFromFileName = (fileName: string): string => {
  const base = baseName(fileName);
  for (const pattern of FILE_NAME_PATTERNS) {
    const match = pattern.exec(base);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return base === "_chat" ? "" : base;
};

/**
 * Un teléfono escrito a mano («+57 300 123 4567», «+52 1 55 1234 5678»,
 * «3001234567») → E.164. Sin «+» y con 10 dígitos que empiezan por 3 se asume
 * Colombia. Devuelve null si no parece un número.
 */
export const normalizePhoneInput = (raw: string): string | null => {
  const text = raw.replace(INVISIBLE, "").trim();
  if (!/^[+\d][\d\s().-]*$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10 && digits.startsWith("3")) return `+57${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
};

/** Un nombre que en realidad es un número (contacto sin guardar en el celular). */
const phoneFromLabel = (label: string): string | null =>
  /^\+[\d\s().-]{7,}$/.test(label.replace(INVISIBLE, "").trim())
    ? normalizePhoneInput(label)
    : null;

/** Avisos de WhatsApp que no escribió nadie, aunque en iPhone lleven autor. */
const SYSTEM_NOTICE =
  /(cifrados de extremo a extremo|end-to-end encrypted|criptografia de ponta a ponta|cambió su número|changed (?:their|his|her) phone number|te bloqueó|you blocked this contact|bloqueaste a este contacto|desbloqueaste a este contacto|mensajes temporales|disappearing messages)/i;

/** Lo que WhatsApp deja en lugar de un adjunto al exportar «sin archivos». */
const MEDIA_PLACEHOLDER =
  /^(<[^>]*omitid[oa]s?>|<media omitted>|<attached:[^>]*>|.*\b(imagen|video|vídeo|audio|sticker|gif|documento|image|document) omitid[oa]$|.*\bomitted$)/i;

/** Encabezado de un mensaje (fecha y hora al inicio de la línea). */
const HEADER = /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}/;
/** El mismo encabezado con autor («… - Nombre: texto» o «[…] Nombre: texto»). */
const HEADER_WITH_AUTHOR =
  /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?\]?\s*(?:-\s*)?[^:]{1,80}?:\s?/i;

/**
 * Antes de leer: las líneas de sistema sin autor («14:05 - Laura cambió su
 * número») se quitan (el lector de pares las pegaría al mensaje anterior).
 */
const MEDIA_TOKEN = "__wa_export_media__";

const prepare = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(/[\u202f\u00a0]/g, " ")
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!HEADER.test(trimmed)) return [line];
      const header = HEADER_WITH_AUTHOR.exec(trimmed);
      if (!header) return [];
      // El lector de pares cambia los adjuntos por null, igual que un mensaje
      // borrado: se marcan antes para saber cu\u00e1les eran adjuntos.
      const rest = trimmed.slice(header[0].length).trim();
      return [MEDIA_PLACEHOLDER.test(rest) ? `${header[0]}${MEDIA_TOKEN}` : trimmed];
    })
    .join("\n");

/**
 * Hora local (la del celular) → instante real. El lector de pares arma la
 * fecha con la zona del proceso; aquí se reinterpreta en la zona de Dayana.
 */
const inZone = (local: Date, timeZone: string): Date => {
  const pad = (n: number) => String(n).padStart(2, "0");
  try {
    return zonedDateTimeToUtc(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
      `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`,
      timeZone
    );
  } catch {
    return local;
  }
};

export const parseExportFile = (
  fileName: string,
  text: string,
  timeZone = "America/Bogota"
): ParsedExportFile => {
  const parsed = parseWhatsAppExport(prepare(text));

  const messages: ExportChatMessage[] = [];
  for (const message of parsed.messages) {
    const body = message.text;
    // Aviso de WhatsApp con autor (iPhone): no es un mensaje de nadie.
    if (body && SYSTEM_NOTICE.test(body) && body.length < 400 && !body.includes("\n")) continue;
    const media = body === MEDIA_TOKEN || Boolean(body?.startsWith(`${MEDIA_TOKEN}\n`));
    messages.push({
      sentAt: inZone(message.at, timeZone),
      author: message.sender.trim(),
      body: media ? body!.slice(MEDIA_TOKEN.length).trim() || null : body,
      media,
    });
  }

  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.author, (counts.get(message.author) ?? 0) + 1);
  const authors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  const nameFromFile = contactNameFromFileName(fileName);
  const phoneFromName =
    phoneFromLabel(nameFromFile) ?? authors.map(phoneFromLabel).find((p): p is string => Boolean(p)) ?? null;

  return {
    contactName: nameFromFile || authors[1] || authors[0] || "",
    phoneFromName,
    messages,
    authors,
  };
};

const sameName = (a: string, b: string) => foldForSearch(a.trim()) === foldForSearch(b.trim());

/**
 * Cuál de los que escriben es Dayana. `hint` (lo que eligió la persona o un
 * nombre como «Dayana») manda; si no, en un chat de dos es el que no es el
 * contacto. null si no se puede saber.
 */
export const detectDayanaAuthor = (
  authors: string[],
  hint?: { override?: string | null; contactName?: string | null; ownerName?: string | null }
): string | null => {
  const override = hint?.override?.trim();
  if (override) return authors.find((a) => sameName(a, override)) ?? override;

  const owner = hint?.ownerName?.trim() || "dayana";
  const byOwner = authors.find((a) => foldForSearch(a).includes(foldForSearch(owner)));
  const contact = hint?.contactName?.trim();

  if (authors.length === 2) {
    if (contact) {
      const other = authors.find((a) => !sameName(a, contact));
      if (other && authors.some((a) => sameName(a, contact))) return other;
    }
    if (byOwner) return byOwner;
    // Contacto sin guardar: aparece como número; Dayana es el otro.
    const phoneAuthor = authors.find((a) => phoneFromLabel(a));
    if (phoneAuthor) return authors.find((a) => a !== phoneAuthor) ?? null;
    return null;
  }

  if (byOwner) return byOwner;
  // Solo escribió el contacto: Dayana no aparece.
  return null;
};

export const DAYANA_MEDIA_NOTE = "📷 Archivo no incluido en la exportación";

export const exportMessageId = (input: {
  threadId: string;
  sentAt: Date;
  occurrence: number;
  author: string;
  body: string | null;
}): string =>
  `export:${createHash("sha256")
    .update(
      [input.threadId, input.sentAt.toISOString(), String(input.occurrence), input.author, input.body ?? ""].join("|")
    )
    .digest("hex")
    .slice(0, 40)}`;

/**
 * Los mensajes del archivo → eventos de historial. El id es determinista:
 * subir el mismo chat (o una exportación más nueva del mismo chat) no duplica.
 *
 * El «índice» del id cuenta repeticiones del mismo (hora, autor, texto) y no la
 * posición en el archivo: así una exportación posterior, con más mensajes,
 * produce los mismos ids para los mensajes que ya estaban.
 */
export const toHistoryEvents = (input: {
  phoneE164: string;
  contactName: string | null;
  dayanaAuthor: string | null;
  messages: ExportChatMessage[];
  metaAccountId: string;
}): NormalizedMessage[] => {
  const threadId = whatsAppDigits(input.phoneE164);
  const seen = new Map<string, number>();
  const participantName = input.contactName?.trim() || null;

  const events: NormalizedMessage[] = [];
  for (const message of input.messages) {
    if (!message.body && !message.media) continue; // mensaje borrado: nada que mostrar
    const key = `${message.sentAt.toISOString()}|${message.author}|${message.body ?? ""}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const isEcho = Boolean(input.dayanaAuthor) && message.author === input.dayanaAuthor;
    events.push({
      kind: "message",
      channel: "WHATSAPP",
      metaAccountId: input.metaAccountId,
      threadId,
      externalMessageId: exportMessageId({
        threadId,
        sentAt: message.sentAt,
        occurrence,
        author: message.author,
        body: message.body,
      }),
      isEcho,
      body: message.media ? DAYANA_MEDIA_NOTE : message.body,
      attachments: [],
      replyToExternalId: null,
      sentAt: message.sentAt,
      participantName,
      isHistory: true,
      ...(message.media ? { system: true } : {}),
    });
  }
  return events;
};
