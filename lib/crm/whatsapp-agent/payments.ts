
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getSiteUrl } from "@/lib/site-url";
import { writeAuditLog } from "../audit";
import { setManualCategory } from "../chat-category";
import { linkConversationToContact, replyToConversation } from "../conversations";
import { upsertContactByPhone } from "../contacts";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { closeAttention, openAttention } from "./attention";

/**
 * Pagos por fuera de la web, en WhatsApp (pedido de la dueña, 2026-10-14):
 *
 * - La asistente comparte las cuentas (Bancolombia, Western Union…) cuando se
 *   las piden. El texto sale tal cual de Ajustes: el modelo nunca escribe un
 *   número de cuenta (podría inventarlo).
 * - Reenvía el enlace de pago personal que Dayana creó para esa persona.
 * - Cuando llega un comprobante, lo deja «por confirmar» aquí, le avisa a
 *   Dayana (suena) y le contesta a la persona que Dayana lo revisa. Solo cuando
 *   Dayana lo confirma la persona pasa a ser clienta, y queda como contacto en
 *   el CRM con su nombre y número.
 */

export type PaymentMethod = WhatsAppAiConfig["payments"]["methods"][number];

export const enabledMethods = (config: WhatsAppAiConfig): PaymentMethod[] =>
  config.payments.methods.filter((m) => m.enabled && m.details.trim());

/** La lista que lee la IA: clave, nombre y a quién va. Sin los datos (esos los pega el código). */
export const paymentMethodsForPrompt = (config: WhatsAppAiConfig): string | null => {
  const methods = enabledMethods(config);
  if (!methods.length) return null;
  return methods.map((m) => `- ${m.key}: ${m.label}${m.when ? ` (${m.when})` : ""}`).join("\n");
};

/** El texto exacto de una forma de pago (o null si no existe o está apagada). */
export const paymentDetails = (config: WhatsAppAiConfig, key: string): PaymentMethod | null =>
  enabledMethods(config).find((m) => m.key.toLowerCase() === key.trim().toLowerCase()) ?? null;

/**
 * El mensaje que sale: lo que escribió la IA y debajo los datos tal cual (y
 * el enlace). Los datos van aparte para que el detector de precios no lea un
 * número de cuenta como un monto.
 */
export const withPaymentBlocks = (
  message: string,
  blocks: { details?: string[]; link?: string | null }
): string => {
  const extra: string[] = [];
  for (const d of blocks.details ?? []) if (d.trim() && !message.includes(d.trim())) extra.push(d.trim());
  if (blocks.link && !message.includes(blocks.link)) extra.push(blocks.link);
  // «Te comparto los datos para el pago» + datos: con dos puntos, como se escribe.
  const intro = extra.length && /[\p{L}\d)]$/u.test(message.trim()) ? `${message.trim()}:` : message.trim();
  return [intro, ...extra].filter(Boolean).join("\n\n");
};

/** El enlace de pago personal vivo más reciente que Dayana creó para esta persona. */
export const activePaymentLinkFor = async (contactId: string | null): Promise<{ url: string; product: string } | null> => {
  if (!contactId) return null;
  const link = await prisma.paymentLink.findFirst({
    where: {
      contactId,
      revokedAt: null,
      paidAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    select: { token: true, product: { select: { title: true } } },
  });
  return link ? { url: `${getSiteUrl()}/pagar/${link.token}`, product: link.product.title } : null;
};

export type ReceiptInput = {
  conversationId: string;
  contactId: string | null;
  messageId: string | null;
  method?: string | null;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  paidOn?: string | null;
  payerName?: string | null;
  summary?: string | null;
  problem?: string | null;
  confirmMessage?: string | null;
};

/** Monto en unidades menores (COP en pesos enteros, USD en centavos), como el resto del CRM. */
export const toMinor = (amount: number | null | undefined, currency: string | null | undefined): number | null => {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const cur = (currency ?? "").toUpperCase();
  return cur === "COP" ? Math.round(amount) : Math.round(amount * 100);
};

const clip = (v: string | null | undefined, max: number) => (v?.trim() ? v.trim().slice(0, max) : null);

/**
 * Guarda el comprobante «por confirmar». Si la misma persona manda más fotos
 * del mismo pago en unos minutos, se completa el que ya estaba.
 */
export const saveReceipt = async (input: ReceiptInput) => {
  const currency = clip(input.currency, 3)?.toUpperCase() ?? null;
  const data = {
    contactId: input.contactId,
    messageId: input.messageId,
    method: clip(input.method, 80),
    amountMinor: toMinor(input.amount, currency),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    reference: clip(input.reference, 120),
    paidOn: clip(input.paidOn, 40),
    payerName: clip(input.payerName, 120),
    summary: clip(input.summary, 300),
    problem: clip(input.problem, 300),
    confirmMessage: clip(input.confirmMessage, 600),
  };
  const recent = await prisma.whatsAppPaymentReceipt.findFirst({
    where: { conversationId: input.conversationId, status: "pending", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (recent) {
    const fill = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null));
    return prisma.whatsAppPaymentReceipt.update({ where: { id: recent.id }, data: fill });
  }
  return prisma.whatsAppPaymentReceipt.create({ data: { conversationId: input.conversationId, ...data } });
};

/** Le avisa a Dayana (suena) y abre «Te toca: pago» hasta que lo confirme. */
export const notifyReceipt = async (input: {
  conversationId: string;
  name: string | null;
  summary: string | null;
  problem: string | null;
  since: Date;
  staff: string[] | "ALL";
}) => {
  await openAttention(input.conversationId, "payment", input.since).catch((e: unknown) =>
    console.warn("[pagos] no se pudo abrir «Te toca»", e)
  );
  fireNotification({
    eventType: "WHATSAPP_AI_ESCALATED",
    severity: input.problem ? "ERROR" : "WARNING",
    title: `${input.problem ? "Pago con un problema" : "Comprobante de pago"}: ${input.name ?? "una persona"}`,
    body: [input.summary, input.problem ? `Ojo: ${input.problem}` : null, "Revísalo y confírmalo en el chat."]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200),
    href: `/admin/whatsapp?conversation=${input.conversationId}`,
    entityType: "Conversation",
    entityId: input.conversationId,
    staff: input.staff,
  });
};

export type ReceiptView = {
  id: string;
  status: string;
  method: string | null;
  amountMinor: number | null;
  currency: string | null;
  reference: string | null;
  paidOn: string | null;
  payerName: string | null;
  summary: string | null;
  problem: string | null;
  confirmMessage: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** La foto del comprobante (si llegó como imagen o PDF). */
  attachment: { kind: string; url: string | null; mimeType: string | null; caption: string | null; mediaId?: string } | null;
};

/** Los comprobantes de un chat (los por confirmar primero). */
export const listReceipts = async (conversationId: string): Promise<ReceiptView[]> => {
  const rows = await prisma.whatsAppPaymentReceipt.findMany({
    where: { conversationId, createdAt: { gte: new Date(Date.now() - 60 * 24 * 3600_000) } },
    orderBy: [{ createdAt: "desc" }],
    take: 10,
  });
  const messageIds = rows.map((r) => r.messageId).filter((id): id is string => Boolean(id));
  const messages = messageIds.length
    ? await prisma.conversationMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true, attachments: true } })
    : [];
  const attachmentOf = new Map(
    messages.map((m) => [m.id, (Array.isArray(m.attachments) ? m.attachments : [])[0] as ReceiptView["attachment"] | undefined])
  );
  return rows
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"))
    .map((r) => ({
      id: r.id,
      status: r.status,
      method: r.method,
      amountMinor: r.amountMinor,
      currency: r.currency,
      reference: r.reference,
      paidOn: r.paidOn,
      payerName: r.payerName,
      summary: r.summary,
      problem: r.problem,
      confirmMessage: r.confirmMessage,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      attachment: (r.messageId && attachmentOf.get(r.messageId)) || null,
    }));
};

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

  let contactId = conversation.contactId;
  let contactName: string | null = null;
  if (input.decision === "confirm") {
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
  }

  await prisma.whatsAppPaymentReceipt.update({
    where: { id: receipt.id },
    data: {
      status: input.decision === "confirm" ? "confirmed" : "rejected",
      contactId,
      decidedById: input.staffUserId,
      decidedAt: new Date(),
    },
  });
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
