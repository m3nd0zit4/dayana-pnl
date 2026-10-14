import { prisma } from "@/lib/db";
import { writeAuditLog } from "../audit";
import { setManualCategory } from "../chat-category";
import { linkConversationToContact, replyToConversation } from "../conversations";
import { upsertContactByPhone } from "../contacts";
import { closeAttention } from "./attention";

/**
 * Dayana confirma o descarta un comprobante de pago que llegó por WhatsApp
 * (lo demás de pagos vive en `payment-info.ts`). Aparte porque trae contactos
 * y conversaciones: lo que lee la IA no puede depender de esto (el agente del
 * panel se arma con cada módulo que alcanza).
 */

export class ReceiptError extends Error {}

/** Nombre y apellido a partir de lo que se sabe (nombre de WhatsApp o el del comprobante). */
const splitName = (full: string | null | undefined): { firstName: string; lastName?: string } => {
  const words = (full ?? "").replace(/[^\p{L}\p{M}' .-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: "Cliente WhatsApp" };
  return { firstName: words[0], ...(words.length > 1 ? { lastName: words.slice(1).join(" ") } : {}) };
};

/**
 * Dayana confirma o descarta un comprobante.
 *
 * Confirmar: la persona queda como contacto del CRM (nombre y número), el chat
 * queda vinculado y marcado como clienta (la IA deja de atenderla), se cierra
 * «Te toca: pago» y, si Dayana quiere, sale el mensaje de confirmación. El
 * monto se registra después con «Registrar pago» (pide el código de
 * verificación, como cualquier pago a mano). Devuelve el contacto.
 */
export const decideReceipt = async (input: {
  receiptId: string;
  decision: "confirm" | "reject";
  staffUserId: string;
  /** Lo que se le envía a la persona (vacío = nada). */
  message?: string | null;
}): Promise<{ contactId: string | null; contactName: string | null; sent: boolean }> => {
  const receipt = await prisma.whatsAppPaymentReceipt.findUnique({
    where: { id: input.receiptId },
    include: {
      conversation: {
        select: { id: true, channel: true, externalThreadId: true, participantName: true, contactId: true },
      },
    },
  });
  if (!receipt) throw new ReceiptError("not_found");
  if (receipt.status !== "pending") throw new ReceiptError("already_decided");
  const conversation = receipt.conversation;
  // Se reclama antes de hacer nada: un doble clic o dos personas a la vez no
  // confirman (ni mandan el mensaje) dos veces.
  const claimed = await prisma.whatsAppPaymentReceipt.updateMany({
    where: { id: receipt.id, status: "pending" },
    data: { status: input.decision === "confirm" ? "confirmed" : "rejected", decidedById: input.staffUserId, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new ReceiptError("already_decided");
  const release = () =>
    prisma.whatsAppPaymentReceipt
      .update({ where: { id: receipt.id }, data: { status: "pending", decidedById: null, decidedAt: null } })
      .catch(() => undefined);

  let contactId = conversation.contactId;
  let contactName: string | null = null;
  if (input.decision === "confirm") {
    try {
      if (!contactId) {
        if (!/^\d{6,15}$/.test(conversation.externalThreadId)) throw new ReceiptError("no_phone");
        const { firstName, lastName } = splitName(conversation.participantName || receipt.payerName);
        const { contact } = await upsertContactByPhone({
          phone: `+${conversation.externalThreadId}`,
          firstName,
          lastName,
          source: "WHATSAPP_DIRECT",
          sourceDetail: "Pago confirmado por WhatsApp",
        });
        contactId = contact.id;
        await linkConversationToContact(conversation.id, contact.id, input.staffUserId);
      }
      const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
      contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || null;
      // La persona ya es clienta: la IA deja de atenderla (salvo datos de pago y comprobantes).
      await setManualCategory(conversation.id, "cliente", input.staffUserId);
    } catch (e) {
      // No quedó hecho: vuelve a estar por confirmar.
      await release();
      throw e;
    }
  }
  if (contactId) await prisma.whatsAppPaymentReceipt.update({ where: { id: receipt.id }, data: { contactId } });
  // Si no queda otro comprobante por confirmar, «Te toca: pago» se cierra.
  const stillPending = await prisma.whatsAppPaymentReceipt.count({
    where: { conversationId: conversation.id, status: "pending" },
  });
  if (stillPending === 0) await closeAttention(conversation.id, { by: "payment" }).catch(() => false);

  let sent = false;
  const message = input.message?.trim();
  if (message) {
    await replyToConversation({ conversationId: conversation.id, body: message, staffUserId: input.staffUserId })
      .then(() => {
        sent = true;
      })
      .catch((e: unknown) => console.warn("[pagos] no se pudo enviar la confirmación", e));
  }

  await writeAuditLog({
    staffUserId: input.staffUserId,
    action: input.decision === "confirm" ? "whatsapp.receipt.confirm" : "whatsapp.receipt.reject",
    entityType: "WhatsAppPaymentReceipt",
    entityId: receipt.id,
    changes: { conversationId: conversation.id, contactId, sent },
  });
  return { contactId, contactName, sent };
};
