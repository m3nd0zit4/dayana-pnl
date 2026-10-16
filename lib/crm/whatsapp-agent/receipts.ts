import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { writeAuditLog } from "../audit";
import { setManualCategory } from "../chat-category";
import { replyToConversation } from "../conversations";
import { ClientContactError, ensureConversationContact } from "../whatsapp-client-contact";
import { closeAttention } from "./attention";
import { isPaymentAck } from "./receipt-ack";

/**
 * Dayana confirma o descarta un comprobante de pago que llegó por WhatsApp
 * (lo demás de pagos vive en `payment-info.ts`). Aparte porque trae contactos
 * y conversaciones: lo que lee la IA no puede depender de esto (el agente del
 * panel se arma con cada módulo que alcanza).
 */

export class ReceiptError extends Error {}

/**
 * Dayana confirma o descarta un comprobante.
 *
 * Confirmar: la persona queda como contacto del CRM (nombre y número), el chat
 * queda vinculado y marcado como clienta (la IA deja de atenderla), se cierra
 * «Te toca: pago» y, si Dayana escribió un mensaje, sale. El pago se registra
 * con «Registrar pago» (pide el código de verificación del correo de Dayana)
 * y queda enlazado al comprobante (`linkReceiptPayment`).
 *
 * `via: "chat"`: Dayana lo confirmó respondiendo desde el celular
 * (`confirmReceiptFromChat`); no hay usuario del CRM detrás.
 */
export const decideReceipt = async (input: {
  receiptId: string;
  decision: "confirm" | "reject";
  staffUserId: string | null;
  /** Lo que se le envía a la persona (vacío = nada). */
  message?: string | null;
  via?: "button" | "chat";
}): Promise<{ contactId: string | null; contactName: string | null; sent: boolean }> => {
  const via = input.via ?? "button";
  const receipt = await prisma.whatsAppPaymentReceipt.findUnique({
    where: { id: input.receiptId },
    include: { conversation: { select: { id: true, participantName: true, contactId: true } } },
  });
  if (!receipt) throw new ReceiptError("not_found");
  if (receipt.status !== "pending") throw new ReceiptError("already_decided");
  const conversation = receipt.conversation;
  // Se reclama antes de hacer nada: un doble clic o dos personas a la vez no
  // confirman (ni mandan el mensaje) dos veces.
  const claimed = await prisma.whatsAppPaymentReceipt.updateMany({
    where: { id: receipt.id, status: "pending" },
    data: {
      status: input.decision === "confirm" ? "confirmed" : "rejected",
      confirmedVia: input.decision === "confirm" ? via : null,
      decidedById: input.staffUserId,
      decidedAt: new Date(),
    },
  });
  if (claimed.count === 0) throw new ReceiptError("already_decided");
  const release = () =>
    prisma.whatsAppPaymentReceipt
      .update({ where: { id: receipt.id }, data: { status: "pending", confirmedVia: null, decidedById: null, decidedAt: null } })
      .catch(() => undefined);

  let contactId = conversation.contactId;
  let contactName: string | null = null;
  if (input.decision === "confirm") {
    try {
      contactId = (
        await ensureConversationContact({
          conversationId: conversation.id,
          staffUserId: input.staffUserId,
          sourceDetail: "Pago confirmado por WhatsApp",
          payerName: receipt.payerName,
        })
      ).contactId;
      const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
      contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || null;
      // La persona ya es clienta: la IA deja de atenderla (salvo datos de pago y comprobantes).
      await setManualCategory(conversation.id, "cliente", input.staffUserId);
    } catch (e) {
      // No quedó hecho: vuelve a estar por confirmar.
      await release();
      if (e instanceof ClientContactError) throw new ReceiptError(e.message);
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
  if (message && input.staffUserId) {
    await replyToConversation({ conversationId: conversation.id, body: message, staffUserId: input.staffUserId })
      .then(() => {
        sent = true;
      })
      .catch((e: unknown) => console.warn("[pagos] no se pudo enviar la confirmación", e));
  }

  await writeAuditLog({
    staffUserId: input.staffUserId ?? undefined,
    action: input.decision === "confirm" ? "whatsapp.receipt.confirm" : "whatsapp.receipt.reject",
    entityType: "WhatsAppPaymentReceipt",
    entityId: receipt.id,
    changes: { conversationId: conversation.id, contactId, sent, via },
  });
  return { contactId, contactName, sent };
};

/** Cuánto después del comprobante cuenta un «recibido» de Dayana. */
const CHAT_ACK_WINDOW_MS = 48 * 3600_000;

/**
 * Dayana respondió desde el celular. Si dice que recibió el pago («he
 * recibido», «recibido, gracias», «ya me llegó») y hay un comprobante por
 * confirmar de antes de ese mensaje, queda confirmado como con el botón:
 * contacto, clienta y «Te toca» cerrado. Solo falta registrar el pago en el
 * CRM (con el código): le llega el aviso. Devuelve cuántos confirmó.
 */
export const confirmReceiptFromChat = async (conversationId: string, externalMessageId: string): Promise<number> => {
  const message = await prisma.conversationMessage.findUnique({
    where: { externalMessageId },
    select: { conversationId: true, direction: true, isEcho: true, isAutoReply: true, kind: true, body: true, sentAt: true },
  });
  if (!message || message.conversationId !== conversationId) return 0;
  if (message.direction !== "OUTBOUND" || !message.isEcho || message.isAutoReply || message.kind === "system") return 0;
  if (!isPaymentAck(message.body)) return 0;
  const pending = await prisma.whatsAppPaymentReceipt.findMany({
    where: {
      conversationId,
      status: "pending",
      createdAt: { lte: message.sentAt, gte: new Date(message.sentAt.getTime() - CHAT_ACK_WINDOW_MS) },
    },
    select: { id: true, summary: true },
  });
  let confirmed = 0;
  for (const r of pending) {
    const result = await decideReceipt({ receiptId: r.id, decision: "confirm", staffUserId: null, message: null, via: "chat" }).catch(
      (e: unknown) => {
        console.warn("[pagos] no se pudo confirmar el comprobante desde el chat", r.id, e);
        return null;
      }
    );
    if (!result) continue;
    confirmed++;
    fireNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `Confirmaste el pago de ${result.contactName ?? "una clienta"} en el chat`,
      body: [r.summary, "Ya es clienta y está en el CRM. Falta registrar el pago (con tu código)."].filter(Boolean).join(" · ").slice(0, 200),
      href: `/admin/whatsapp?conversation=${conversationId}`,
      entityType: "Conversation",
      entityId: conversationId,
      staff: "ALL",
    });
  }
  return confirmed;
};

/**
 * El pago del CRM que se registró para un comprobante confirmado (lo crea
 * «Registrar pago», que pide el código de Dayana). Solo se enlaza un pago
 * aprobado del mismo contacto, y una sola vez.
 */
export const linkReceiptPayment = async (input: { receiptId: string; paymentId: string; staffUserId: string }) => {
  const receipt = await prisma.whatsAppPaymentReceipt.findUnique({
    where: { id: input.receiptId },
    select: { id: true, status: true, contactId: true, paymentId: true },
  });
  if (!receipt) throw new ReceiptError("not_found");
  if (receipt.status !== "confirmed") throw new ReceiptError("not_confirmed");
  if (receipt.paymentId) throw new ReceiptError("already_linked");
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, enrollment: { select: { contactId: true } } },
  });
  if (!payment || payment.status !== "APPROVED") throw new ReceiptError("payment_not_found");
  if (receipt.contactId && payment.enrollment.contactId !== receipt.contactId) throw new ReceiptError("other_contact");
  const updated = await prisma.whatsAppPaymentReceipt.updateMany({
    where: { id: receipt.id, paymentId: null },
    data: { paymentId: payment.id },
  });
  if (updated.count === 0) throw new ReceiptError("already_linked");
  await writeAuditLog({
    staffUserId: input.staffUserId,
    action: "whatsapp.receipt.payment",
    entityType: "WhatsAppPaymentReceipt",
    entityId: receipt.id,
    changes: { paymentId: payment.id },
  });
  return { ok: true as const };
};

/** «Ya está registrado» / «no hace falta»: el comprobante confirmado deja de pedir el pago. */
export const dismissReceiptPayment = async (input: { receiptId: string; staffUserId: string }) => {
  const updated = await prisma.whatsAppPaymentReceipt.updateMany({
    where: { id: input.receiptId, status: "confirmed", paymentId: null, paymentDismissedAt: null },
    data: { paymentDismissedAt: new Date() },
  });
  if (updated.count === 0) throw new ReceiptError("already_decided");
  await writeAuditLog({
    staffUserId: input.staffUserId,
    action: "whatsapp.receipt.payment_dismissed",
    entityType: "WhatsAppPaymentReceipt",
    entityId: input.receiptId,
    changes: {},
  });
  return { ok: true as const };
};
