import { Prisma, type ConversationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { pageCredentials, whatsAppCredentials } from "./client";
import type { NormalizedEvent, NormalizedMessage } from "./inbound";
import { rehostAttachment, type StoredAttachment } from "./media";

/**
 * Persistencia de los eventos entrantes de Meta.
 *
 * Todo lo de aquí debe ser idempotente: Meta reintenta, y el mismo mensaje
 * puede llegar varias veces. La barrera es el índice único de
 * `MetaWebhookEvent.eventId`, y por debajo el de
 * `ConversationMessage.externalMessageId`.
 */

const UNIQUE_VIOLATION = "P2002";

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === UNIQUE_VIOLATION;

const credentialsFor = (channel: ConversationChannel) =>
  channel === "WHATSAPP" ? whatsAppCredentials() : pageCredentials();

/**
 * Reserva el id del mensaje. Devuelve false si ya se había procesado.
 *
 * Se dedupea por id de **mensaje** y no por entrega porque Meta reenvía el
 * mismo mensaje dentro de envoltorios distintos; la entrega no es estable.
 */
export const claimMetaEvent = async (
  object: string,
  eventId: string,
  payload: Prisma.InputJsonValue | undefined
): Promise<boolean> => {
  try {
    await prisma.metaWebhookEvent.create({
      data: { object, eventId, payload },
    });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
};

/**
 * Resuelve el contacto del CRM para un hilo.
 *
 * WhatsApp entrega el teléfono, así que se empareja solo. Messenger e Instagram
 * entregan un PSID/IGSID opaco: solo hay contacto si alguien vinculó ese hilo
 * antes a mano, y quedarse en null es un estado normal, no un fallo.
 */
const resolveContactId = async (
  channel: ConversationChannel,
  threadId: string
): Promise<string | null> => {
  const identity = await prisma.contactChannelIdentity.findUnique({
    where: { channel_externalId: { channel, externalId: threadId } },
    select: { contactId: true },
  });
  if (identity) return identity.contactId;

  if (channel !== "WHATSAPP") return null;

  // WhatsApp entrega el número sin `+`; los contactos se guardan en E.164.
  const contact = await prisma.contact.findUnique({
    where: { phoneE164: `+${threadId.replace(/\D/g, "")}` },
    select: { id: true },
  });
  return contact?.id ?? null;
};

const storeAttachments = async (
  message: NormalizedMessage
): Promise<StoredAttachment[]> => {
  if (message.attachments.length === 0) return [];

  const credentials = credentialsFor(message.channel);
  if (!credentials) {
    return message.attachments.map((attachment) => ({
      kind: attachment.kind,
      url: null,
      mimeType: attachment.mimeType ?? null,
      caption: attachment.caption ?? null,
      unavailableReason: "credentials_missing",
    }));
  }

  return Promise.all(
    message.attachments.map((attachment) =>
      rehostAttachment(attachment, credentials)
    )
  );
};

export type IngestResult =
  | { outcome: "stored"; conversationId: string; isInbound: boolean }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string };

/** Guarda un mensaje entrante (o un eco saliente) y actualiza su hilo. */
export const ingestMessage = async (
  message: NormalizedMessage
): Promise<IngestResult> => {
  const attachments = await storeAttachments(message);
  const contactId = await resolveContactId(message.channel, message.threadId);

  const conversation = await prisma.conversation.upsert({
    where: {
      channel_externalThreadId: {
        channel: message.channel,
        externalThreadId: message.threadId,
      },
    },
    create: {
      channel: message.channel,
      externalThreadId: message.threadId,
      metaAccountId: message.metaAccountId,
      contactId,
      participantName: message.participantName,
      lastMessageAt: message.sentAt,
      lastInboundAt: message.isEcho ? null : message.sentAt,
      unreadCount: message.isEcho ? 0 : 1,
      status: "OPEN",
    },
    update: {
      lastMessageAt: message.sentAt,
      // Un eco no reabre la ventana de 24 h: la ventana la abre el cliente.
      ...(message.isEcho
        ? { status: "PENDING" as const }
        : {
            lastInboundAt: message.sentAt,
            unreadCount: { increment: 1 },
            status: "OPEN" as const,
          }),
      // Nunca sobreescribir un contacto ya vinculado a mano con un null.
      ...(contactId ? { contactId } : {}),
      ...(message.participantName
        ? { participantName: message.participantName }
        : {}),
    },
    select: { id: true },
  });

  try {
    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: message.isEcho ? "OUTBOUND" : "INBOUND",
        status: message.isEcho ? "SENT" : "RECEIVED",
        externalMessageId: message.externalMessageId,
        replyToExternalId: message.replyToExternalId,
        body: message.body,
        attachments:
          attachments.length > 0
            ? (attachments as unknown as Prisma.InputJsonValue)
            : undefined,
        isEcho: message.isEcho,
        sentAt: message.sentAt,
      },
    });
  } catch (e) {
    // El contador del hilo ya se incrementó arriba; con un duplicado real esto
    // solo ocurre si el claim de MetaWebhookEvent no atajó, así que se informa.
    if (isUniqueViolation(e)) return { outcome: "duplicate" };
    throw e;
  }

  return {
    outcome: "stored",
    conversationId: conversation.id,
    isInbound: !message.isEcho,
  };
};

/** Aplica un acuse de entrega sobre un mensaje ya guardado. */
export const ingestStatus = async (
  event: Extract<NormalizedEvent, { kind: "status" }>
): Promise<IngestResult> => {
  const existing = await prisma.conversationMessage.findUnique({
    where: { externalMessageId: event.externalMessageId },
    select: { id: true, conversationId: true },
  });
  if (!existing) return { outcome: "ignored", reason: "unknown_message" };

  await prisma.conversationMessage.update({
    where: { id: existing.id },
    data: {
      status: event.status,
      failedReason: event.failedReason,
      ...(event.status === "DELIVERED" ? { deliveredAt: event.at } : {}),
      ...(event.status === "READ" ? { readAt: event.at } : {}),
    },
  });

  return {
    outcome: "stored",
    conversationId: existing.conversationId,
    isInbound: false,
  };
};

const CHANNEL_LABEL: Record<ConversationChannel, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
};

/** Avisa al staff de un mensaje nuevo, agrupado por hilo. */
export const notifyInboundMessage = (
  message: NormalizedMessage,
  conversationId: string
) => {
  const who = message.participantName ?? message.threadId;
  fireNotification({
    eventType: "INBOX_MESSAGE_RECEIVED",
    title: `${CHANNEL_LABEL[message.channel]}: mensaje de ${who}`,
    body: message.body?.slice(0, 160) ?? "(adjunto)",
    href: `/admin/inbox/${conversationId}`,
    entityType: "Conversation",
    entityId: conversationId,
    staff: "ALL",
  });
};

/**
 * Procesa un evento ya normalizado, de principio a fin.
 *
 * Vive aquí y no dentro de la función de Inngest porque tiene dos llamantes: la
 * función de Inngest en el camino normal, y la propia ruta del webhook cuando
 * Inngest no está configurado. Un mensaje de un cliente no se puede perder solo
 * porque falte una variable de entorno.
 */
export const processNormalizedEvent = async (
  object: string,
  event: NormalizedEvent
): Promise<IngestResult> => {
  if (event.kind === "status") {
    // Los acuses no se dedupean: son idempotentes por naturaleza (escriben un
    // estado final) y llegan varios por mensaje, con el mismo id de mensaje.
    return ingestStatus(event);
  }

  const claimed = await claimMetaEvent(
    object,
    event.externalMessageId,
    event as unknown as Prisma.InputJsonValue
  );
  if (!claimed) return { outcome: "duplicate" };

  const result = await ingestMessage(event);

  if (result.outcome === "stored" && result.isInbound) {
    notifyInboundMessage(event, result.conversationId);
  }

  return result;
};
