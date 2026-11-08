import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import type { DisplayBlock } from "@/agent/lib/display";
import { prisma } from "@/lib/db";
import { formatMoneyMinor } from "@/lib/crm/money";

export default defineTool({
  description:
    "List payment receipts (comprobantes) that arrived by WhatsApp for payments outside the site (transfer, Nequi, Western Union…). The AI reads each one and leaves it «pending» until Dayana confirms or rejects it; amount/reference are what the AI read and may be wrong. `paymentId` set = the CRM payment was registered for it; confirmed without paymentId and not dismissed = still to register. The result always carries `toRegister` (confirmed by Dayana but the payment was never recorded in the CRM, so it is missing from sales) whatever `status` you filter by. When asked what is pending with receipts, report BOTH: the ones waiting for Dayana's review and the `toRegister` ones. Name people by `chat` (the WhatsApp chat) and add `payerName` only when it differs (someone else paid).",
  inputSchema: z.object({
    status: z.enum(["pending", "confirmed", "rejected"]).optional(),
    conversationId: z.string().min(1).optional(),
    days: z.number().int().min(1).max(365).optional().describe("Look-back window, default 30"),
    limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
  }),
  async execute({ status, conversationId, days = 30, limit = 30 }, ctx) {
    requireStaff(ctx);
    const where = {
      ...(status ? { status } : {}),
      ...(conversationId ? { conversationId } : {}),
      createdAt: { gte: new Date(Date.now() - days * 24 * 3600_000) },
    };
    const [rows, counts, unregistered] = await Promise.all([
      prisma.whatsAppPaymentReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          conversation: {
            select: {
              participantName: true,
              externalThreadId: true,
              contact: { select: { firstName: true, lastName: true, displayName: true } },
            },
          },
        },
      }),
      prisma.whatsAppPaymentReceipt.groupBy({
        by: ["status"],
        where: { createdAt: where.createdAt, ...(conversationId ? { conversationId } : {}) },
        _count: { _all: true },
      }),
      prisma.whatsAppPaymentReceipt.findMany({
        where: {
          status: "confirmed",
          paymentId: null,
          paymentDismissedAt: null,
          createdAt: where.createdAt,
          ...(conversationId ? { conversationId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          conversation: {
            select: {
              participantName: true,
              externalThreadId: true,
              contact: { select: { firstName: true, lastName: true, displayName: true } },
            },
          },
        },
      }),
    ]);

    const chatName = (r: {
      conversation: {
        participantName: string | null;
        externalThreadId: string;
        contact: { firstName: string; lastName: string | null; displayName: string | null } | null;
      };
    }) => {
      const c = r.conversation.contact;
      return (
        c?.displayName ??
        (c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : null) ??
        r.conversation.participantName ??
        r.conversation.externalThreadId
      );
    };

    const receipts = rows.map((r) => ({
      id: r.id,
      status: r.status,
      chat: chatName(r),
      payerName: r.payerName,
      method: r.method,
      amount: r.amountMinor != null && r.currency ? `${formatMoneyMinor(r.amountMinor, r.currency)} ${r.currency}` : null,
      amountMinor: r.amountMinor,
      currency: r.currency,
      reference: r.reference,
      paidOn: r.paidOn,
      summary: r.summary,
      problem: r.problem,
      confirmedVia: r.confirmedVia,
      paymentId: r.paymentId,
      toRegister: r.status === "confirmed" && !r.paymentId && !r.paymentDismissedAt,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      ref: {
        type: "conversation" as const,
        id: r.conversationId,
        href: `/admin/whatsapp?conversation=${r.conversationId}`,
      },
      ...(r.contactId
        ? { contactRef: { type: "contact" as const, id: r.contactId, href: `/admin/contacts/${r.contactId}` } }
        : {}),
    }));

    const display: DisplayBlock[] = receipts.length
      ? [
          {
            kind: "table",
            title: "Comprobantes por WhatsApp",
            columns: ["Fecha", "Chat", "Pagó", "Método", "Importe", "Estado"],
            rows: receipts.map((r) => [
              r.createdAt.slice(0, 10),
              r.chat,
              r.payerName && r.payerName !== r.chat ? r.payerName : "",
              r.method ?? "",
              r.amount ?? "",
              r.toRegister ? "confirmado · falta registrar" : r.status,
            ]),
          },
        ]
      : [];

    return {
      days,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      receipts,
      toRegister: unregistered.map((r) => ({
        chat: chatName(r),
        payerName: r.payerName,
        amount: r.amountMinor != null && r.currency ? `${formatMoneyMinor(r.amountMinor, r.currency)} ${r.currency}` : null,
        method: r.method,
        confirmedAt: r.decidedAt?.toISOString() ?? null,
        ref: { type: "conversation" as const, id: r.conversationId, href: `/admin/whatsapp?conversation=${r.conversationId}` },
      })),
      display,
    };
  },
});
