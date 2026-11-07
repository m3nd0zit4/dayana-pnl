import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import type { DisplayBlock } from "@/agent/lib/display";
import { prisma } from "@/lib/db";
import { formatMoneyMinor } from "@/lib/crm/money";

export default defineTool({
  description:
    "List payment receipts (comprobantes) that arrived by WhatsApp for payments outside the site (transfer, Nequi, Western Union…). The AI reads each one and leaves it «pending» until Dayana confirms or rejects it; amount/reference are what the AI read and may be wrong. `paymentId` set = the CRM payment was registered for it; confirmed without paymentId and not dismissed = still to register. Use it for «¿qué comprobantes faltan por revisar?».",
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
    const [rows, counts] = await Promise.all([
      prisma.whatsAppPaymentReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { conversation: { select: { participantName: true, externalThreadId: true } } },
      }),
      prisma.whatsAppPaymentReceipt.groupBy({
        by: ["status"],
        where: { createdAt: where.createdAt, ...(conversationId ? { conversationId } : {}) },
        _count: { _all: true },
      }),
    ]);

    const receipts = rows.map((r) => ({
      id: r.id,
      status: r.status,
      person: r.payerName ?? r.conversation.participantName ?? r.conversation.externalThreadId,
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
            columns: ["Fecha", "Persona", "Método", "Importe", "Estado"],
            rows: receipts.map((r) => [r.createdAt.slice(0, 10), r.person, r.method ?? "", r.amount ?? "", r.status]),
          },
        ]
      : [];

    return {
      days,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      receipts,
      display,
    };
  },
});
