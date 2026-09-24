import { Prisma, type ConversationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { resolveWhatsAppCredentials } from "./whatsapp-provider";
import { resolvePageCredentials } from "./credentials";
import type { NormalizedEvent, NormalizedMessage } from "./inbound";
import { rehostAttachment, type StoredAttachment } from "./media";
import { applyStatus } from "./status";

/**
 * Persistencia de los eventos entrantes de Meta.
 *
 * Todo lo de aquí debe ser idempotente: Meta reintenta, la cola de entrada
 * (`lib/meta/inbox.ts`) reintenta, y el mismo mensaje puede llegar varias
 * veces. La barrera es el índice único de `ConversationMessage.externalMessageId`:
 * un mensaje cuenta como procesado solo cuando YA está guardado en su chat
 * (antes se marcaba «visto» primero y, si algo fallaba después, se perdía).
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
  // México llega como 521… y Argentina como 549…, pero el contacto puede
  // estar guardado como +52… / +54…: se prueban las dos formas.
  const contact = await prisma.contact.findFirst({
    where: { phoneE164: { in: contactPhoneCandidates(threadId) } },
    select: { id: true },
  });
  return contact?.id ?? null;
};

/** +521… ↔ +52…, +549… ↔ +54…: las formas en que puede estar guardado el contacto. */
export const contactPhoneCandidates = (threadId: string): string[] => {
  const d = threadId.replace(/\D/g, "");
  const out = [`+${d}`];
  if (d.length === 13 && (d.startsWith("521") || d.startsWith("549"))) out.push(`+${d.slice(0, 2)}${d.slice(3)}`);
  if (d.length === 12 && (d.startsWith("52") || d.startsWith("54"))) out.push(`+${d.slice(0, 2)}${d.startsWith("52") ? "1" : "9"}${d.slice(2)}`);
  return out;
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
  const already = await prisma.conversationMessage.findUnique({
    where: { externalMessageId: message.externalMessageId },
    select: { id: true },
  });
  if (already) return { outcome: "duplicate" };

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
  const stored = await prisma.$transaction(async (tx) => {
  const conversation = message.isHistory
    ? await tx.conversation.upsert({
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
    : await tx.conversation.upsert({
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

    await tx.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: message.isEcho ? "OUTBOUND" : "INBOUND",
        status: message.isEcho ? "SENT" : "RECEIVED",
        externalMessageId: message.externalMessageId,
        replyToExternalId: message.replyToExternalId,
        body:
          message.body ||
          (attachments.find((a) => a.transcript)?.transcript
            ? `🎤 ${attachments.find((a) => a.transcript)!.transcript}`
            : message.body),
        attachments:
          attachments.length > 0
            ? (attachments as unknown as Prisma.InputJsonValue)
            : undefined,
        isEcho: message.isEcho,
        sentAt: message.sentAt,
      },
    });
    return conversation;
  }).catch((e: unknown) => {
    // Otro proceso lo guardó en el mismo instante: la transacción se deshace
    // entera (el contador de no leídos no se infla).
    if (isUniqueViolation(e)) return null;
    throw e;
  });
  if (!stored) return { outcome: "duplicate" };
  const conversation = stored;

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

/**
 * Aplica un acuse de entrega. El estado solo avanza (`lib/meta/status.ts`) y
 * queda en el historial. Si el mensaje aún no está guardado, se informa y la
 * cola de entrada lo reintenta.
 */
export const ingestStatus = async (
  event: Extract<NormalizedEvent, { kind: "status" }>
): Promise<IngestResult> => {
  const { messageId } = await applyStatus({
    wamid: event.externalMessageId,
    status: event.status,
    at: event.at,
    failedReason: event.failedReason,
    failedCode: event.failedCode ?? null,
  });
  if (!messageId) return { outcome: "ignored", reason: "unknown_message" };
  const message = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: { conversationId: true },
  });
  return { outcome: "stored", conversationId: message?.conversationId ?? "", isInbound: false };
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
export type ProcessOptions = {
  /**
   * Si se pasa, la IA no corre aquí: se le avisa al llamante (la cola de
   * entrada) para que la lance al final, en paralelo, sin frenar los demás
   * mensajes que esperan.
   */
  deferAi?: (conversationId: string, triggerMessageId: string) => void;
};

export const processNormalizedEvent = async (
  object: string,
  event: NormalizedEvent,
  opts: ProcessOptions = {}
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

  const result = await ingestMessage(event);
  if (result.outcome !== "stored") return result;

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
    // Lo que la IA había propuesto ya no es la respuesta: Dayana contestó.
    const { supersedePending } = await import("@/lib/crm/whatsapp-agent/approvals");
    await supersedePending(result.conversationId, "Dayana respondió desde el celular.").catch(
      () => undefined
    );
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
      // «Stop», «no me escribas más»: no vuelve a recibir envíos del CRM.
      const { isOptOutMessage } = await import("@/lib/crm/whatsapp-outbound-plan");
      if (isOptOutMessage(event.body)) {
        const conv = await prisma.conversation.findUnique({
          where: { id: result.conversationId },
          select: { contactId: true },
        });
        if (conv?.contactId) {
          await prisma.contact.update({ where: { id: conv.contactId }, data: { notifyWhatsapp: false } });
          const { fireAuditLog } = await import("@/lib/crm/audit");
          fireAuditLog({
            action: "WHATSAPP_OPT_OUT",
            entityType: "Contact",
            entityId: conv.contactId,
            changes: { message: event.body?.slice(0, 80) },
          });
        }
      }
      // Saludo, IA y estados en vivo: todo pasa por el ejecutor, que espera a
      // que la persona termine de escribir y contesta la ráfaga entera una sola
      // vez. Nunca lanza hacia fuera.
      if (opts.deferAi) {
        opts.deferAi(result.conversationId, event.externalMessageId);
      } else {
        const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");
        await runWhatsAppAi({
          conversationId: result.conversationId,
          triggerMessageId: event.externalMessageId,
        });
      }
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

  await finishHistorySync(touched);
  return { stored, conversations: touched.size };
};

/**
 * Después de guardar historial: aprende de los chats que cambiaron y, si aún
 * no hay guía de estilo, la escribe. Lo usan la importación y la cola de entrada.
 */
export const finishHistorySync = async (touched: Set<string>): Promise<void> => {
  const { learnFromConversation } = await import("@/lib/crm/whatsapp-learning");
  for (const conversationId of touched) {
    await learnFromConversation(conversationId).catch((e: unknown) =>
      console.warn("[historial WhatsApp] no se pudo aprender de un chat", e)
    );
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
};
