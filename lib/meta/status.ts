import { Prisma, type MessageDeliveryStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Estados de un mensaje que SOLO AVANZAN.
 *
 * WhatsApp no promete orden: un «entregado» puede llegar después del «leído»,
 * y un acuse puede llegar antes de que el mensaje esté guardado. Aquí:
 * - cada acuse queda en el historial (`message_status_events`, Info del mensaje);
 * - el estado del mensaje se actualiza con `WHERE status_rank < nuevo`: la base
 *   garantiza que nunca retrocede, llegue en el orden que llegue;
 * - un fallo solo cuenta si el mensaje aún no se había entregado (uno leído que
 *   luego «falla» se queda leído; el fallo queda en el historial).
 */

export const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  RECEIVED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

/**
 * El estado que queda después de aplicar `next` sobre `current` (pura; la
 * misma regla que hace el UPDATE).
 */
export const nextStatus = (current: string, next: string): string => {
  const cur = STATUS_RANK[current] ?? 0;
  if (next === "FAILED") return cur < STATUS_RANK.DELIVERED ? "FAILED" : current;
  const nxt = STATUS_RANK[next] ?? 0;
  return nxt > cur ? next : current;
};

export type StatusInput = {
  wamid: string;
  status: MessageDeliveryStatus;
  at: Date;
  failedReason?: string | null;
  failedCode?: number | null;
};

/**
 * Aplica un acuse. Devuelve el id del mensaje, o null si el mensaje aún no
 * existe (el acuse queda guardado sin ligar y la cola de entrada reintenta).
 */
export const applyStatus = async (input: StatusInput): Promise<{ messageId: string | null }> => {
  const message = await prisma.conversationMessage.findUnique({
    where: { externalMessageId: input.wamid },
    select: { id: true },
  });

  await prisma.messageStatusEvent
    .upsert({
      where: { wamid_status: { wamid: input.wamid, status: input.status } },
      create: {
        wamid: input.wamid,
        status: input.status,
        occurredAt: input.at,
        messageId: message?.id ?? null,
        errorCode: input.failedCode ?? null,
        errorTitle: input.failedReason ?? null,
      },
      update: message ? { messageId: message.id } : {},
    })
    .catch((e: unknown) => {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    });

  if (!message) return { messageId: null };
  await applyToMessage(message.id, input);
  return { messageId: message.id };
};

const applyToMessage = async (messageId: string, input: StatusInput) => {
  const rank = STATUS_RANK[input.status] ?? 0;
  if (input.status === "FAILED") {
    const { count } = await prisma.conversationMessage.updateMany({
      where: { id: messageId, statusRank: { lt: STATUS_RANK.DELIVERED } },
      data: {
        status: "FAILED",
        statusRank: STATUS_RANK.FAILED,
        failedReason: input.failedReason ?? "WhatsApp no pudo entregarlo",
        failedCode: input.failedCode ?? null,
      },
    });
    if (count > 0) await markBulkRecipientFailed(messageId, input.failedReason ?? null);
    return;
  }
  await prisma.conversationMessage.updateMany({
    where: { id: messageId, statusRank: { lt: rank } },
    data: { status: input.status, statusRank: rank },
  });
  // Las horas se guardan aunque el estado ya fuera más alto: un «entregado»
  // que llega después del «leído» sigue diciendo cuándo se entregó.
  if (input.status === "DELIVERED" || input.status === "READ") {
    await prisma.conversationMessage.updateMany({
      where: { id: messageId, deliveredAt: null },
      data: { deliveredAt: input.at },
    });
  }
  if (input.status === "READ") {
    await prisma.conversationMessage.updateMany({
      where: { id: messageId, readAt: null },
      data: { readAt: input.at },
    });
  }
};

/** Un envío masivo cuyo mensaje falló después: la lista de Envíos lo refleja. */
const markBulkRecipientFailed = async (messageId: string, reason: string | null) => {
  const recipient = await prisma.whatsAppSendRecipient.findFirst({
    where: { messageId, status: "SENT" },
    select: { id: true, sendId: true },
  });
  if (!recipient) return;
  const { count } = await prisma.whatsAppSendRecipient.updateMany({
    where: { id: recipient.id, status: "SENT" },
    data: { status: "FAILED", error: (reason ?? "WhatsApp no pudo entregarlo").slice(0, 300) },
  });
  if (count > 0) {
    await prisma.whatsAppSend.update({
      where: { id: recipient.sendId },
      data: { sent: { decrement: 1 }, failed: { increment: 1 } },
    });
  }
};

/**
 * Cuando un mensaje recibe su wamid (al enviarse), se aplican los acuses que
 * llegaron antes y quedaron sin ligar.
 */
export const attachPendingStatuses = async (messageId: string, wamid: string): Promise<void> => {
  const pending = await prisma.messageStatusEvent.findMany({
    where: { wamid, messageId: null },
    orderBy: { occurredAt: "asc" },
  });
  for (const ev of pending) {
    await prisma.messageStatusEvent.update({ where: { id: ev.id }, data: { messageId } });
    await applyToMessage(messageId, {
      wamid,
      status: ev.status as MessageDeliveryStatus,
      at: ev.occurredAt,
      failedReason: ev.errorTitle,
      failedCode: ev.errorCode,
    });
  }
};
