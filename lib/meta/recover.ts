import { prisma } from "@/lib/db";

/**
 * Lo que quedó a medias porque una invocación se cortó (tiempo agotado,
 * despliegue, caída). Lo llama el barrido de la cola de entrada. Nada se
 * reenvía a ciegas: los envíos llevan clave (`clientKey`), así que volver a
 * intentarlos nunca duplica un mensaje que sí salió.
 */
export const recoverStuck = async (): Promise<{ approvals: number; queued: number; bulk: number }> => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

  // Aprobaciones que quedaron «enviando»: vuelven a esperar a Dayana.
  const approvals = await prisma.whatsAppAiRun.updateMany({
    where: { status: "SENDING", decidedAt: { lt: minutesAgo(5) } },
    data: { status: "AWAITING_APPROVAL", decidedAt: null },
  });

  // Mensajes en cola sin confirmación de WhatsApp: se marcan para revisar.
  // No se reenvían solos (puede que sí hayan salido).
  const queued = await prisma.conversationMessage.updateMany({
    where: { direction: "OUTBOUND", status: "QUEUED", externalMessageId: null, sentAt: { lt: minutesAgo(3) } },
    data: {
      status: "FAILED",
      statusRank: 4,
      failedReason: "WhatsApp no confirmó el envío: revisa en el celular si llegó antes de reenviarlo.",
    },
  });

  // Destinatarios de un envío masivo que quedaron «enviando»: vuelven a la
  // cola; su clave evita mandarles dos veces si sí salió.
  const bulk = await prisma.whatsAppSendRecipient.updateMany({
    where: { status: "SENDING", processedAt: { lt: minutesAgo(3) } },
    data: { status: "PENDING" },
  });

  return { approvals: approvals.count, queued: queued.count, bulk: bulk.count };
};
