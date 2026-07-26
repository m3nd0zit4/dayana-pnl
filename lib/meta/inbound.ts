import type {
  ConversationChannel,
  MessageDeliveryStatus,
} from "@prisma/client";

/**
 * Normalización de los webhooks de Meta.
 *
 * WhatsApp, Messenger e Instagram llegan al mismo endpoint con tres formas
 * distintas. Todo lo que sabe de esas diferencias vive aquí: el resto del
 * sistema solo ve `NormalizedEvent`, así que añadir un canal no toca ni la
 * persistencia ni la interfaz.
 *
 * Este módulo es puro — sin Prisma, sin red — para poder probarlo con payloads
 * de ejemplo del panel de Meta.
 */

export type NormalizedAttachment = {
  kind: "image" | "video" | "audio" | "document" | "sticker" | "unknown";
  /** WhatsApp entrega un id que hay que resolver; Messenger/IG dan la URL. */
  mediaId?: string;
  url?: string;
  mimeType?: string;
  caption?: string;
};

export type NormalizedMessage = {
  kind: "message";
  channel: ConversationChannel;
  /** Cuenta que recibió el mensaje: phone_number_id, page id o ig id. */
  metaAccountId: string;
  /** Identidad de la persona: teléfono, PSID o IGSID. Clave del hilo. */
  threadId: string;
  externalMessageId: string;
  /** Un eco (enviado desde la app de Meta) se guarda como saliente. */
  isEcho: boolean;
  body: string | null;
  attachments: NormalizedAttachment[];
  replyToExternalId: string | null;
  sentAt: Date;
  participantName: string | null;
};

export type NormalizedStatus = {
  kind: "status";
  externalMessageId: string;
  status: MessageDeliveryStatus;
  at: Date;
  failedReason: string | null;
};

export type NormalizedEvent = NormalizedMessage | NormalizedStatus;

// ── Utilidades ─────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * WhatsApp manda epoch en **segundos** como string; Messenger manda epoch en
 * milisegundos como number. Confundirlos coloca los mensajes en 1970 o en el
 * año 57000, y el hilo se ordena mal sin que nada falle ruidosamente.
 */
const secondsToDate = (value: unknown): Date => {
  const n = Number(value);
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
};

const millisToDate = (value: unknown): Date => {
  const n = Number(value);
  return Number.isFinite(n) ? new Date(n) : new Date();
};

const ATTACHMENT_KINDS = new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
]);

const toAttachmentKind = (raw: string | null): NormalizedAttachment["kind"] =>
  raw && ATTACHMENT_KINDS.has(raw)
    ? (raw as NormalizedAttachment["kind"])
    : "unknown";

// ── WhatsApp Cloud API ─────────────────────────────────────────────────────

const WHATSAPP_STATUS: Record<string, MessageDeliveryStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

const normalizeWhatsAppValue = (value: Record<string, unknown>): NormalizedEvent[] => {
  const events: NormalizedEvent[] = [];

  const metaAccountId =
    asString(asRecord(value.metadata)?.phone_number_id) ?? "unknown";

  // `contacts` trae el nombre de perfil, pero indexado por wa_id, no por
  // mensaje. Se resuelve a un mapa antes de recorrer los mensajes.
  const profileNames = new Map<string, string>();
  for (const entry of asArray(value.contacts)) {
    const contact = asRecord(entry);
    const waId = asString(contact?.wa_id);
    const name = asString(asRecord(contact?.profile)?.name);
    if (waId && name) profileNames.set(waId, name);
  }

  for (const entry of asArray(value.messages)) {
    const message = asRecord(entry);
    if (!message) continue;

    const id = asString(message.id);
    const from = asString(message.from);
    if (!id || !from) continue;

    const type = asString(message.type);
    const attachments: NormalizedAttachment[] = [];
    let body = asString(asRecord(message.text)?.body);

    if (type && type !== "text") {
      const media = asRecord(message[type]);
      if (media) {
        const caption = asString(media.caption);
        attachments.push({
          kind: toAttachmentKind(type),
          mediaId: asString(media.id) ?? undefined,
          mimeType: asString(media.mime_type) ?? undefined,
          caption: caption ?? undefined,
        });
        // El pie de foto es el texto del mensaje para quien lo lee.
        if (!body && caption) body = caption;
      }
    }

    events.push({
      kind: "message",
      channel: "WHATSAPP",
      metaAccountId,
      threadId: from,
      externalMessageId: id,
      isEcho: false,
      body,
      attachments,
      replyToExternalId: asString(asRecord(message.context)?.id),
      sentAt: secondsToDate(message.timestamp),
      participantName: profileNames.get(from) ?? null,
    });
  }

  for (const entry of asArray(value.statuses)) {
    const status = asRecord(entry);
    if (!status) continue;

    const id = asString(status.id);
    const mapped = WHATSAPP_STATUS[asString(status.status) ?? ""];
    if (!id || !mapped) continue;

    const firstError = asRecord(asArray(status.errors)[0]);

    events.push({
      kind: "status",
      externalMessageId: id,
      status: mapped,
      at: secondsToDate(status.timestamp),
      failedReason:
        asString(firstError?.title) ?? asString(firstError?.message) ?? null,
    });
  }

  return events;
};

// ── Messenger e Instagram ──────────────────────────────────────────────────

/**
 * Messenger e Instagram comparten formato: la diferencia es solo el `object`.
 *
 * En un eco, `sender` es la Página y `recipient` es la persona, así que la
 * clave del hilo se toma del lado contrario. Leerla siempre de `sender` crearía
 * un hilo falso con la propia Página en cuanto Dayana respondiera desde el móvil.
 */
const normalizeMessagingEntry = (
  entry: Record<string, unknown>,
  channel: ConversationChannel
): NormalizedEvent[] => {
  const events: NormalizedEvent[] = [];
  const pageId = asString(entry.id) ?? "unknown";

  for (const raw of asArray(entry.messaging)) {
    const item = asRecord(raw);
    const message = asRecord(item?.message);
    if (!item || !message) continue;

    const mid = asString(message.mid);
    if (!mid) continue;

    const isEcho = message.is_echo === true;
    const senderId = asString(asRecord(item.sender)?.id);
    const recipientId = asString(asRecord(item.recipient)?.id);
    const threadId = isEcho ? recipientId : senderId;
    if (!threadId) continue;

    const attachments: NormalizedAttachment[] = [];
    for (const rawAttachment of asArray(message.attachments)) {
      const attachment = asRecord(rawAttachment);
      if (!attachment) continue;
      attachments.push({
        kind: toAttachmentKind(asString(attachment.type)),
        url: asString(asRecord(attachment.payload)?.url) ?? undefined,
      });
    }

    events.push({
      kind: "message",
      channel,
      metaAccountId: pageId,
      threadId,
      externalMessageId: mid,
      isEcho,
      body: asString(message.text),
      attachments,
      replyToExternalId: asString(asRecord(message.reply_to)?.mid),
      sentAt: millisToDate(item.timestamp),
      participantName: null,
    });
  }

  return events;
};

// ── Entrada pública ────────────────────────────────────────────────────────

export const META_OBJECTS = [
  "whatsapp_business_account",
  "page",
  "instagram",
] as const;

export type MetaObject = (typeof META_OBJECTS)[number];

export const isMetaObject = (value: unknown): value is MetaObject =>
  typeof value === "string" &&
  (META_OBJECTS as readonly string[]).includes(value);

/**
 * Convierte un payload crudo de Meta en eventos normalizados.
 *
 * Nunca lanza: un webhook con una forma inesperada devuelve una lista vacía. Un
 * 500 aquí solo consigue que Meta reintente el mismo payload roto en bucle.
 */
export const normalizeMetaPayload = (payload: unknown): NormalizedEvent[] => {
  const body = asRecord(payload);
  const object = asString(body?.object);
  if (!body || !isMetaObject(object)) return [];

  const events: NormalizedEvent[] = [];

  for (const rawEntry of asArray(body.entry)) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;

    if (object === "whatsapp_business_account") {
      for (const rawChange of asArray(entry.changes)) {
        const change = asRecord(rawChange);
        if (asString(change?.field) !== "messages") continue;
        const value = asRecord(change?.value);
        if (value) events.push(...normalizeWhatsAppValue(value));
      }
      continue;
    }

    events.push(
      ...normalizeMessagingEntry(
        entry,
        object === "instagram" ? "INSTAGRAM" : "MESSENGER"
      )
    );
  }

  return events;
};

/** Clave de serialización por hilo, para que Inngest no reordene un mismo chat. */
export const threadKeyOf = (event: NormalizedEvent): string =>
  event.kind === "message"
    ? `${event.channel}:${event.threadId}`
    : `status:${event.externalMessageId}`;
