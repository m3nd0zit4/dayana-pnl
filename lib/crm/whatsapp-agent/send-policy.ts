import { prisma } from "@/lib/db";

import { isAutoSend } from "../whatsapp-attention-rules";

/**
 * Una sola regla para todos los mensajes que salen solos (auditoría 21-nov): si Dayana o su
 * equipo le acaban de escribir a la persona, la conversación es de ellas y nada automático
 * se mete. Antes cada envío (la pregunta «¿Pudiste hablar?», el mensaje para reagendar, el
 * aviso de espera de la IA) decidía por su cuenta: a Kate y a Yanet les llegó «¿Pudiste
 * hablar con Dayana?» 4–6 segundos después de que Dayana les escribió, y en 41 casos en 14
 * días la IA mandó un aviso con Dayana escribiendo en el chat.
 *
 * Solo para lo que sale solo o es una espera: una respuesta de la IA a una pregunta de la
 * persona sigue sus propias reglas (`run.ts`: la IA nunca deja de responder).
 */

/** Minutos que una conversación «es de Dayana» después de que ella escribe. */
export const HUMAN_ACTIVE_MIN = { proactive: 30, holding: 15 } as const;

/** Lo pura: ¿alguno de estos mensajes lo escribió Dayana o su equipo en los últimos `minutes`? */
export const humanWroteWithin = (
  messages: { direction: string; isAutoReply: boolean | null; source: string | null; clientKey: string | null; sentAt: Date }[],
  now: Date,
  minutes: number
): boolean =>
  messages.some(
    (m) =>
      m.direction === "OUTBOUND" &&
      !m.isAutoReply &&
      m.source !== "approval" &&
      !isAutoSend(m) &&
      now.getTime() - m.sentAt.getTime() < minutes * 60_000 &&
      m.sentAt.getTime() <= now.getTime()
  );

/** ¿Dayana o su equipo le escribieron en los últimos `minutes`? (lee la base en el momento de enviar). */
export const humanActive = async (conversationId: string, minutes: number, now = new Date()): Promise<boolean> => {
  const rows = await prisma.conversationMessage.findMany({
    where: {
      conversationId,
      direction: "OUTBOUND",
      kind: "message",
      status: { not: "FAILED" },
      sentAt: { gte: new Date(now.getTime() - minutes * 60_000) },
    },
    select: { direction: true, isAutoReply: true, source: true, clientKey: true, sentAt: true },
    take: 20,
  });
  return humanWroteWithin(rows, now, minutes);
};
