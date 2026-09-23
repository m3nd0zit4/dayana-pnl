import { Prisma, type ConversationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { resolveWhatsAppCredentials } from "./whatsapp-provider";
import { resolvePageCredentials } from "./credentials";
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
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === UNIQUE_VIOLATION;

const credentialsFor = async (channel: ConversationChannel) =>
  channel === "WHATSAPP"
    ? resolveWhatsAppCredentials()
    : resolvePageCredentials();

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

  const credentials = await credentialsFor(message.channel);
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
  | { outcome: "contact_synced" }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string };

/** Guarda un mensaje entrante (o un eco saliente) y actualiza su hilo. */
export const ingestMessage = async (
  message: NormalizedMessage
): Promise<IngestResult> => {
  const attachments = await storeAttachments(message);
  const contactId = await resolveContactId(message.channel, message.threadId);

  const where = {
    channel_externalThreadId: {
      channel: message.channel,
      externalThreadId: message.threadId,
    },
  };

  // El historial es pasado: crea el hilo si no existe, pero no lo abre, no
  // suma no leídos y solo adelanta las fechas si de verdad son más nuevas.
  // Seis meses de chats no pueden aparecer de golpe como pendientes.
  const conversation = message.isHistory
    ? await prisma.conversation.upsert({
        where,
        create: {
          channel: message.channel,
          externalThreadId: message.threadId,
          metaAccountId: message.metaAccountId,
          contactId,
          lastMessageAt: message.sentAt,
          lastInboundAt: message.isEcho ? null : message.sentAt,
          unreadCount: 0,
          status: "CLOSED",
        },
        update: contactId ? { contactId } : {},
        select: { id: true },
      })
    : await prisma.conversation.upsert({
        where,
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

  if (message.isHistory) {
    await prisma.conversation.updateMany({
      where: { id: conversation.id, lastMessageAt: { lt: message.sentAt } },
      data: { lastMessageAt: message.sentAt },
    });
    if (!message.isEcho) {
      await prisma.conversation.updateMany({
        where: {
          id: conversation.id,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: message.sentAt } },
          ],
        },
        data: { lastInboundAt: message.sentAt },
      });
    }
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
    href:
      message.channel === "WHATSAPP"
        ? `/admin/whatsapp?conversation=${conversationId}`
        : `/admin/inbox/${conversationId}`,
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

  if (event.kind === "contact") {
    const { upsertKnownContact } = await import("@/lib/crm/whatsapp-learning");
    await upsertKnownContact(event);
    return { outcome: "contact_synced" };
  }

  const claimed = await claimMetaEvent(
    object,
    event.externalMessageId,
    event as unknown as Prisma.InputJsonValue
  );
  if (!claimed) return { outcome: "duplicate" };

  const result = await ingestMessage(event);

  // El pasado no avisa, no saluda y no contesta. Se aprende de él en tanda,
  // al final de la sincronización (`processHistoryEvents`).
  if (event.isHistory) return result;

  // Dayana contestó desde la app del celular (coexistencia): el hilo es suyo
  // y lo que escribió es un ejemplo más de cómo responde.
  if (
    result.outcome === "stored" &&
    event.isEcho &&
    event.channel === "WHATSAPP"
  ) {
    const { pauseAutoReply } = await import("@/lib/crm/whatsapp-autoreply");
    await pauseAutoReply(result.conversationId).catch(() => undefined);
    const { learnFromLatestReply } =
      await import("@/lib/crm/whatsapp-learning");
    await learnFromLatestReply(result.conversationId);
    const { learnIfCorrectingAutoReply } = await import(
      "@/lib/crm/whatsapp-agent/corrections"
    );
    await learnIfCorrectingAutoReply(result.conversationId).catch(
      () => undefined
    );
  }

  if (result.outcome === "stored" && result.isInbound) {
    notifyInboundMessage(event, result.conversationId);
    // Respuesta automática de WhatsApp. Import perezoso: arrastra el modelo y
    // el catálogo del CRM, y la mayoría de los eventos de Meta (acuses, ecos,
    // Instagram) no lo necesitan. Nunca lanza hacia fuera.
    if (event.channel === "WHATSAPP") {
      // Saludo, IA y estados en vivo: todo pasa por el ejecutor, que espera a
      // que la persona termine de escribir y contesta la ráfaga entera una sola
      // vez. Nunca lanza hacia fuera.
      const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");
      await runWhatsAppAi({
        conversationId: result.conversationId,
        triggerMessageId: event.externalMessageId,
      });
    }
  }

  return result;
};

/**
 * El historial de la app llega en trozos grandes (cientos de mensajes). Se
 * procesa aquí, en serie y sin la cola: mandar un evento por mensaje a Inngest
 * serían miles de eventos para algo que no tiene prisa ni a nadie esperando.
 * Al final se aprende de los hilos que cambiaron.
 */
export const processHistoryEvents = async (
  object: string,
  events: NormalizedEvent[]
): Promise<{ stored: number; conversations: number }> => {
  const touched = new Set<string>();
  let stored = 0;
  for (const event of events) {
    try {
      const result = await processNormalizedEvent(object, event);
      if (result.outcome === "stored") {
        stored++;
        touched.add(result.conversationId);
      }
    } catch (e) {
      console.error("[historial WhatsApp] no se pudo guardar un mensaje", e);
    }
  }

  const { learnFromConversation } = await import("@/lib/crm/whatsapp-learning");
  for (const conversationId of touched) {
    await learnFromConversation(conversationId);
  }

  // Con el historial ya aprendido, la guía de estilo se escribe sola si
  // todavía no hay una: así la IA habla como Dayana desde el primer mensaje.
  if (touched.size > 0) {
    try {
      const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import(
        "@/lib/crm/whatsapp-ai-config"
      );
      const config = await getWhatsAppAiConfig();
      if (!config.styleGuide.trim()) {
        const { draftStyleGuide } = await import("@/lib/crm/whatsapp-learning");
        const styleGuide = (await draftStyleGuide()).slice(0, 4000);
        if (styleGuide.trim()) await setWhatsAppAiConfig({ ...config, styleGuide });
      }
    } catch (e) {
      console.warn("[historial WhatsApp] sin guía de estilo todavía", e);
    }
  }
  return { stored, conversations: touched.size };
};
