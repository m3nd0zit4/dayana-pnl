import { prisma } from "@/lib/db";
import { isAutoSend } from "../whatsapp-attention-rules";
import { isPaymentInfo } from "./chat-payment-link";

/**
 * Lo que Dayana escribió ella misma en un chat (celular o CRM): no la IA, ni
 * lo automático (recordatorios, masivos, eventos), ni una propuesta de la IA
 * que ella aprobó. Lo usan los recordatorios, el seguimiento de la llamada y
 * la sala de espera para no hablar encima de ella.
 */
const dayanaMessagesSince = (conversationId: string, since: Date) =>
  prisma.conversationMessage.findMany({
    where: {
      conversationId,
      direction: "OUTBOUND",
      isAutoReply: false,
      kind: "message",
      status: { not: "FAILED" },
      sentAt: { gte: since },
      OR: [{ source: null }, { source: { not: "approval" } }],
    },
    orderBy: { sentAt: "desc" },
    take: 60,
    select: { sentAt: true, source: true, clientKey: true, body: true },
  });

/** Lo último que Dayana le escribió desde `since` (o null). */
export const dayanaWroteAt = async (conversationId: string | null, since: Date): Promise<Date | null> => {
  if (!conversationId) return null;
  const rows = await dayanaMessagesSince(conversationId, since);
  return rows.find((m) => !isAutoSend(m))?.sentAt ?? null;
};

/**
 * Cuándo Dayana le escribió cómo pagar desde `since` (enlace, cuenta, Nequi,
 * valor, «mándame el comprobante»): ya hablaron de la sesión y los valores
 * (dueña, 21-oct). Null si no.
 */
export const dayanaPaymentInfoAt = async (conversationId: string | null, since: Date): Promise<Date | null> => {
  if (!conversationId) return null;
  const rows = await dayanaMessagesSince(conversationId, since);
  return rows.find((m) => !isAutoSend(m) && isPaymentInfo(m.body))?.sentAt ?? null;
};
