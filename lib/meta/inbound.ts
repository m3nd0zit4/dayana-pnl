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
  /**
   * Mensaje antiguo que llega en la sincronización del historial de la app
   * (coexistencia). Se guarda para que la IA aprenda y para que el hilo tenga
   * contexto, pero no avisa, no saluda y no dispara la respuesta automática:
   * es pasado, no alguien esperando.
   */
  isHistory?: boolean;
};

/** Un contacto de la libreta de la app de WhatsApp Business (coexistencia). */
export type NormalizedContactSync = {
  kind: "contact";
  /** Teléfono en dígitos, sin `+`, igual que el id del hilo de WhatsApp. */
  phone: string;
  name: string | null;
  action: "add" | "remove";
};

export type NormalizedStatus = {
  kind: "status";
  externalMessageId: string;
  status: MessageDeliveryStatus;
  at: Date;
  failedReason: string | null;
  /** Código de error de WhatsApp (131047, 131051…), si falló. */
  failedCode?: number | null;
};

export type NormalizedEvent =
  NormalizedMessage | NormalizedStatus | NormalizedContactSync;

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

/**
 * Mensajes de WhatsApp que no son texto ni archivo. Devuelve el texto que los
 * representa, `null` si no hay nada que guardar, o `undefined` si el tipo no
 * es de estos (texto o archivo, que se tratan aparte).
 */
const describeSpecialMessage = (
  type: string | null,
  message: Record<string, unknown>
): string | null | undefined => {
  switch (type) {
    case "reaction": {
      const emoji = asString(asRecord(message.reaction)?.emoji);
      // Quitar una reacción llega como reacción vacía: no es un mensaje.
      return emoji ? `Reaccionó ${emoji}` : null;
    }
    case "location": {
      const loc = asRecord(message.location);
      const lat = loc?.latitude;
      const lng = loc?.longitude;
      const label = [asString(loc?.name), asString(loc?.address)].filter(Boolean).join(" · ");
      return `📍 Ubicación${label ? `: ${label}` : ""}${
        lat != null && lng != null ? `
https://maps.google.com/?q=${lat},${lng}` : ""
      }`;
    }
    case "contacts": {
      const names = asArray(message.contacts)
        .map((c) => {
          const rec = asRecord(c);
          const name = asString(asRecord(rec?.name)?.formatted_name);
          const phone = asString(asRecord(asArray(rec?.phones)[0])?.phone);
          return [name, phone].filter(Boolean).join(" ");
        })
        .filter(Boolean);
      return `👤 Contacto compartido: ${names.join(", ") || "sin datos"}`;
    }
    case "interactive": {
      const i = asRecord(message.interactive);
      const reply = asRecord(i?.button_reply) ?? asRecord(i?.list_reply);
      return asString(reply?.title) ?? "(respuesta a un botón)";
    }
    case "button":
      return asString(asRecord(message.button)?.text) ?? "(respuesta a un botón)";
    case "request_welcome":
      return "👋 Abrió el chat";
    case "order": {
      const items = asArray(asRecord(message.order)?.product_items).length;
      return `🛒 Pedido${items ? ` (${items} producto${items === 1 ? "" : "s"})` : ""}`;
    }
    case "ephemeral":
      return "(Mensaje temporal: ábrelo en el celular)";
    case "unsupported":
    case "unknown":
      return "(Mensaje que WhatsApp no deja ver aquí: ábrelo en el celular)";
    case "system":
      return null;
    default:
      return undefined;
  }
};

/**
 * Un mensaje de WhatsApp en formato Cloud API. El mismo objeto llega en
 * `messages` (entrante), en `message_echoes` (lo que Dayana escribe desde la
 * app del celular) y dentro de `history` (el pasado); solo cambia de quién es
 * el hilo y hacia dónde va.
 */
const parseWhatsAppMessage = (
  message: Record<string, unknown>,
  ctx: {
    metaAccountId: string;
    threadId: string;
    isEcho: boolean;
    participantName: string | null;
    isHistory?: boolean;
  }
): NormalizedMessage | null => {
  const id = asString(message.id);
  if (!id) return null;

  const type = asString(message.type);
  // En el historial, los medios llegan primero como marcador vacío. Un
  // marcador no dice nada: se omite.
  if (type === "media_placeholder") return null;

  const attachments: NormalizedAttachment[] = [];
  let body = asString(asRecord(message.text)?.body);

  // Lo que no es texto ni archivo se convierte en texto legible: si no, en el
  // CRM salía como «unknown» y la IA no sabía qué le habían mandado.
  const special = describeSpecialMessage(type, message);
  if (special !== undefined) {
    if (special === null) return null;
    body = special;
  } else if (type && type !== "text") {
    const media = asRecord(message[type]);
    if (!media || (!ATTACHMENT_KINDS.has(type) && !asString(media.id))) {
      // Un tipo nuevo de WhatsApp sin archivo que bajar (encuesta, «ver una
      // vez», etc.): se dice qué es en vez de un adjunto vacío que «no carga».
      console.warn(`[whatsapp] tipo de mensaje sin soporte: ${type} (${Object.keys(message).join(",")})`);
      body = body ?? `(Mensaje de WhatsApp tipo «${type}» que no se puede ver aquí: ábrelo en el celular)`;
    } else {
      const caption = asString(media.caption);
      const mime = asString(media.mime_type);
      attachments.push({
        // Tipo por lo que el archivo ES: un video mandado «como archivo» se ve como video.
        kind: ATTACHMENT_KINDS.has(type) && type !== "document"
          ? toAttachmentKind(type)
          : mime?.startsWith("video/")
            ? "video"
            : mime?.startsWith("audio/")
              ? "audio"
              : mime?.startsWith("image/")
                ? "image"
                : toAttachmentKind(type),
        mediaId: asString(media.id) ?? undefined,
        mimeType: asString(media.mime_type) ?? undefined,
        caption: caption ?? undefined,
      });
      // El pie de foto es el texto del mensaje para quien lo lee.
      if (!body && caption) body = caption;
    }
  }

  const referral = asRecord(message.referral);
  if (referral) {
    const ad = asString(referral.headline) ?? asString(referral.body) ?? asString(referral.source_url);
    body = `${body ?? ""}${body ? "\n" : ""}(Llegó desde un anuncio${ad ? `: ${ad}` : ""})`;
  }

  return {
    kind: "message",
    channel: "WHATSAPP",
    metaAccountId: ctx.metaAccountId,
    threadId: ctx.threadId,
    externalMessageId: id,
    isEcho: ctx.isEcho,
    body,
    attachments,
    replyToExternalId: asString(asRecord(message.context)?.id),
    sentAt: secondsToDate(message.timestamp),
    participantName: ctx.participantName,
    ...(ctx.isHistory ? { isHistory: true } : {}),
  };
};

const digits = (value: string | null): string | null =>
  value ? value.replace(/\D/g, "") || null : null;

/**
 * Lo que Dayana escribe desde la app del celular (coexistencia). Va al hilo
 * del destinatario (`to`), como saliente.
 */
const normalizeWhatsAppEchoes = (
  value: Record<string, unknown>
): NormalizedEvent[] => {
  const metaAccountId =
    asString(asRecord(value.metadata)?.phone_number_id) ?? "unknown";
  const events: NormalizedEvent[] = [];
  for (const entry of asArray(value.message_echoes)) {
    const message = asRecord(entry);
    const to = digits(asString(message?.to));
    if (!message || !to) continue;
    const parsed = parseWhatsAppMessage(message, {
      metaAccountId,
      threadId: to,
      isEcho: true,
      participantName: null,
    });
    if (parsed) events.push(parsed);
  }
  return events;
};

/**
 * El historial de la app (hasta 6 meses), que Meta manda una sola vez al
 * conectar el número en coexistencia. Cada hilo trae su id (el teléfono de la
 * persona) y sus mensajes; los que no salen de la persona son de Dayana.
 */
const normalizeWhatsAppHistory = (
  value: Record<string, unknown>
): NormalizedEvent[] => {
  const metaAccountId =
    asString(asRecord(value.metadata)?.phone_number_id) ?? "unknown";
  const events: NormalizedEvent[] = [];

  for (const rawChunk of asArray(value.history)) {
    const chunk = asRecord(rawChunk);
    for (const rawThread of asArray(chunk?.threads)) {
      const thread = asRecord(rawThread);
      const threadId = digits(asString(thread?.id));
      if (!thread || !threadId) continue;

      for (const rawMessage of asArray(thread.messages)) {
        const message = asRecord(rawMessage);
        if (!message) continue;
        const from = digits(asString(message.from));
        const parsed = parseWhatsAppMessage(message, {
          metaAccountId,
          threadId,
          isEcho: from !== null && from !== threadId,
          participantName: null,
          isHistory: true,
        });
        if (parsed) events.push(parsed);
      }
    }
  }
  return events;
};

/** La libreta de contactos de la app (coexistencia). */
const normalizeWhatsAppStateSync = (
  value: Record<string, unknown>
): NormalizedEvent[] => {
  const events: NormalizedEvent[] = [];
  for (const raw of asArray(value.state_sync)) {
    const item = asRecord(raw);
    if (asString(item?.type) !== "contact") continue;
    const contact = asRecord(item?.contact);
    const phone = digits(asString(contact?.phone_number));
    if (!phone) continue;
    events.push({
      kind: "contact",
      phone,
      name: asString(contact?.full_name) ?? asString(contact?.first_name),
      action: asString(item?.action) === "remove" ? "remove" : "add",
    });
  }
  return events;
};

const normalizeWhatsAppValue = (
  value: Record<string, unknown>
): NormalizedEvent[] => {
  const events: NormalizedEvent[] = [];

  const metaAccountId =
    asString(asRecord(value.metadata)?.phone_number_id) ?? "unknown";

  // `contacts` trae el nombre de perfil, pero indexado por wa_id, no por
  // mensaje. Se resuelve a un mapa antes de recorrer los mensajes.
  const profileNames = new Map<string, string>();
  const contacts = asArray(value.contacts).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  for (const contact of contacts) {
    const name = asString(asRecord(contact.profile)?.name);
    for (const key of [asString(contact.wa_id), asString(contact.user_id)]) {
      if (key && name) profileNames.set(key, name);
    }
  }

  for (const entry of asArray(value.messages)) {
    const message = asRecord(entry);
    if (!message) continue;
    // Con los nombres de usuario de WhatsApp (2026) un mensaje puede llegar sin
    // `from` (el teléfono), solo con el id de usuario. Antes esos mensajes se
    // descartaban en silencio: nunca aparecían en el CRM. Ahora el hilo es el
    // teléfono si viene, y si no el id de usuario o el del contacto.
    const from =
      asString(message.from) ??
      asString(message.from_user_id) ??
      asString(contacts[0]?.wa_id) ??
      asString(contacts[0]?.user_id);
    if (!from) continue;
    const parsed = parseWhatsAppMessage(message, {
      metaAccountId,
      threadId: from,
      isEcho: false,
      participantName:
        profileNames.get(from) ??
        profileNames.get(asString(message.from_user_id) ?? "") ??
        asString(asRecord(contacts[0]?.profile)?.name) ??
        null,
    });
    if (parsed) events.push(parsed);
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
      failedCode: typeof firstError?.code === "number" ? firstError.code : null,
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
        const value = asRecord(change?.value);
        if (!value) continue;
        switch (asString(change?.field)) {
          case "messages":
            events.push(...normalizeWhatsAppValue(value));
            break;
          case "smb_message_echoes":
            events.push(...normalizeWhatsAppEchoes(value));
            break;
          case "history":
            events.push(...normalizeWhatsAppHistory(value));
            break;
          case "smb_app_state_sync":
            events.push(...normalizeWhatsAppStateSync(value));
            break;
        }
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
export const threadKeyOf = (event: NormalizedEvent): string => {
  if (event.kind === "message") return `${event.channel}:${event.threadId}`;
  if (event.kind === "contact") return `contact:${event.phone}`;
  return `status:${event.externalMessageId}`;
};

/**
 * Historial y libreta de la app (coexistencia): llegan de golpe, una sola vez
 * y sin nadie esperando. No pasan por la cola; se procesan en serie en
 * `processHistoryEvents`.
 */
export const isBulkSyncEvent = (event: NormalizedEvent): boolean =>
  (event.kind === "message" && event.isHistory === true) ||
  event.kind === "contact";
