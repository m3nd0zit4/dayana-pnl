import { prisma } from "@/lib/db";
import { sendWhatsAppReaction } from "@/lib/meta/send";

/**
 * Lo que se hace sobre UN mensaje del chat de WhatsApp (no sobre el chat):
 * reaccionar y ver su «Info del mensaje».
 */

export class MessageActionError extends Error {}

/**
 * Dayana reacciona a un mensaje. Sale por WhatsApp (dentro de la ventana de
 * 24 h) y queda guardada como reacción «business»; un emoji vacío la quita.
 * Solo los mensajes con `wamid` se pueden reaccionar: WhatsApp los identifica así.
 */
export const reactToMessage = async (input: {
  conversationId: string;
  messageId: string;
  emoji: string;
}): Promise<{ ok: true; dryRun: boolean }> => {
  const message = await prisma.conversationMessage.findFirst({
    where: { id: input.messageId, conversationId: input.conversationId },
    select: {
      id: true,
      externalMessageId: true,
      conversation: { select: { channel: true, externalThreadId: true, lastInboundAt: true } },
    },
  });
  if (!message) throw new MessageActionError("not_found");
  if (!message.externalMessageId) {
    throw new MessageActionError("Ese mensaje no tiene id de WhatsApp: no se le puede reaccionar.");
  }
  const emoji = input.emoji.trim();
  const { dryRun } = await sendWhatsAppReaction(message.conversation, message.externalMessageId, emoji);
  if (emoji) {
    await prisma.messageReaction.upsert({
      where: { messageId_actor: { messageId: message.id, actor: "business" } },
      create: { messageId: message.id, actor: "business", emoji },
      update: { emoji },
    });
  } else {
    await prisma.messageReaction.deleteMany({ where: { messageId: message.id, actor: "business" } });
  }
  // Para que la pantalla (y las demás pestañas) se enteren del cambio.
  await prisma.conversationMessage.update({ where: { id: message.id }, data: { updatedAt: new Date() } });
  return { ok: true, dryRun };
};

export type MessageInfo = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  failedReason: string | null;
  /** Historial de acuses de WhatsApp, del más viejo al más nuevo. */
  events: { status: string; at: string; errorCode: number | null; errorTitle: string | null }[];
};

/** «Info del mensaje»: cuándo se envió, le llegó, lo leyó o falló. */
export const getMessageInfo = async (messageId: string): Promise<MessageInfo | null> => {
  const m = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      direction: true,
      status: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      failedReason: true,
      conversation: { select: { channel: true } },
      statusEvents: {
        orderBy: { occurredAt: "asc" },
        select: { status: true, occurredAt: true, errorCode: true, errorTitle: true },
      },
    },
  });
  if (!m || m.conversation.channel !== "WHATSAPP") return null;
  return {
    id: m.id,
    direction: m.direction as MessageInfo["direction"],
    status: m.status,
    sentAt: m.sentAt.toISOString(),
    deliveredAt: m.deliveredAt?.toISOString() ?? null,
    readAt: m.readAt?.toISOString() ?? null,
    failedReason: m.status === "FAILED" ? (m.failedReason ?? null) : null,
    events: m.statusEvents.map((e) => ({
      status: e.status,
      at: e.occurredAt.toISOString(),
      errorCode: e.errorCode,
      errorTitle: e.errorTitle,
    })),
  };
};
