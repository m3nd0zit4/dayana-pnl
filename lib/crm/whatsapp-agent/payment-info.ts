
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getSiteUrl } from "@/lib/site-url";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { openAttention } from "./attention";
import { providerLabel, webPaymentForReceipt } from "./receipt-web-payment";

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
  blocks: { details?: string[]; link?: string | null; /** Comunidad, curso… */ links?: string[] }
): string => {
  const extra: string[] = [];
  for (const d of blocks.details ?? []) if (d.trim() && !message.includes(d.trim())) extra.push(d.trim());
  if (blocks.link && !message.includes(blocks.link)) extra.push(blocks.link);
  for (const l of blocks.links ?? []) if (l.trim() && !message.includes(l.trim()) && !extra.includes(l.trim())) extra.push(l.trim());
  // «Te comparto los datos para el pago» + datos: con dos puntos, como se escribe.
  // No detrás de un enlace («…/comunidad:» ya no abre).
  const intro =
    extra.length && /[\p{L}\d)]$/u.test(message.trim()) && !/(?:https?:\/\/|www\.)\S+$/i.test(message.trim()) ? `${message.trim()}:` : message.trim();
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
    select: { token: true, customConcept: true, product: { select: { title: true } } },
  });
  // Un enlace de monto libre cuelga del producto oculto «Pago personalizado»:
  // lo que se cobra lo dice su concepto.
  return link
    ? { url: `${getSiteUrl()}/pagar/${link.token}`, product: link.customConcept ?? link.product.title }
    : null;
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
  /** button | chat (Dayana respondió «recibido» desde el celular). */
  confirmedVia: string | null;
  contactId: string | null;
  contactName: string | null;
  paymentId: string | null;
  /** Confirmado, sin pago registrado y sin «no hace falta»: falta registrarlo (con el código). */
  needsPayment: boolean;
  /** Dayana ya le escribió algo después del comprobante: no hace falta otro mensaje. */
  dayanaReplied: boolean;
  /** La foto del comprobante (si llegó como imagen o PDF). */
  attachment: { kind: string; url: string | null; mimeType: string | null; caption: string | null; mediaId?: string } | null;
  /**
   * Por confirmar, pero el pago ya entró solo por la página (misma referencia en
   * Mercado Pago o PayPal): confirmar vincula el chat a esa ficha y no pide registrarlo.
   */
  webPayment: { provider: string; amountMinor: number; currency: string; paidAt: string; product: string | null } | null;
};

/**
 * El mensaje que la IA dejó para cuando Dayana confirme. A veces deja el de
 * espera («Dayana lo revisa y te confirmamos», 15-oct-2026): ese no sirve
 * para confirmar y no se ofrece.
 */
export const usableConfirmMessage = (text: string | null | undefined): string | null => {
  const t = text?.trim();
  if (!t) return null;
  return /\b(lo|la) revis[ae]\b|\brevisa\b|te confirmamos|le aviso|le avis[eé]|en cuanto lo confirme/i.test(t) ? null : t;
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
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((id): id is string => Boolean(id)))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const contactNameOf = new Map(contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ") || null]));
  // Lo último que Dayana escribió ella misma (celular o CRM), no la IA ni los envíos automáticos.
  const oldest = rows.reduce<Date | null>((min, r) => (!min || r.createdAt < min ? r.createdAt : min), null);
  const lastHuman = oldest
    ? await prisma.conversationMessage.findFirst({
        where: { conversationId, direction: "OUTBOUND", isAutoReply: false, kind: "message", status: { not: "FAILED" }, sentAt: { gt: oldest } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      })
    : null;
  // Por confirmar: ¿ya entró por la página? (Gina, 25-oct.)
  const web = new Map(
    await Promise.all(
      rows
        .filter((r) => r.status === "pending" && r.reference)
        .map(async (r) => [r.id, await webPaymentForReceipt(r).catch(() => null)] as const)
    )
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
      confirmMessage: usableConfirmMessage(r.confirmMessage),
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      confirmedVia: r.confirmedVia,
      contactId: r.contactId,
      contactName: r.contactId ? (contactNameOf.get(r.contactId) ?? null) : null,
      paymentId: r.paymentId,
      needsPayment: r.status === "confirmed" && !r.paymentId && !r.paymentDismissedAt,
      dayanaReplied: Boolean(lastHuman && lastHuman.sentAt > r.createdAt),
      attachment: (r.messageId && attachmentOf.get(r.messageId)) || null,
      webPayment: (() => {
        const w = web.get(r.id);
        return w ? { provider: providerLabel(w.provider), amountMinor: w.amountMinor, currency: w.currency, paidAt: w.paidAt.toISOString(), product: w.product } : null;
      })(),
    }));
};
