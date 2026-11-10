import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { defineTool } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { requireStaff } from "@/lib/crm-tools/guard";
import type { DisplayBlock } from "@/lib/crm-tools/display";
import { formatMoneyMinor } from "@/lib/crm/money";
import { paymentProviderLabel } from "@/lib/crm/payment-labels";
import { listPayments } from "@/lib/crm/payments-list";

const money = (minor: number, currency: string) => `${formatMoneyMinor(minor, currency)} ${currency}`;

export default defineTool({
  description:
    "List payments with filters (status, provider, product, date range by paid/created day, free-text on payer/contact/reference, or only the ones not linked to a known person) and the totals per currency for the WHOLE filtered set, not just the rows shown. Use it for 'qué pagos entraron hoy', 'pagos fallidos de esta semana', 'cuánto ha pagado Ana', 'pagos sin identificar'. For period comparisons and breakdowns use crm_stats instead.",
  inputSchema: z.object({
    q: z.string().trim().max(80).optional().describe("Name, email, phone or provider reference"),
    status: z.nativeEnum(PaymentStatus).optional(),
    provider: z.nativeEnum(PaymentProvider).optional(),
    productId: z.string().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    unidentified: z.boolean().optional().describe("Only approved payments not linked to a real contact yet"),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async execute({ q, status, provider, productId, from, to, unidentified, limit }, ctx) {
    requireStaff(ctx);
    const result = await listPayments({ q, status, provider, productId, from, to, unidentified, limit: limit ?? 15 });
    const rows = result.payments.map((p) => {
      const c = p.enrollment.contact;
      const name = c.displayName ?? `${c.firstName} ${c.lastName ?? ""}`.trim();
      return {
        id: p.id,
        status: p.status,
        provider: paymentProviderLabel(p.provider),
        amount: money(p.amountMinor, p.currency),
        product: p.enrollment.product.title,
        contact: name,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        failure: p.failureMessage ?? p.failureCode,
        unidentified: p.unidentified,
        ref: { type: "contact" as const, id: c.id, href: `/admin/contacts/${c.id}` },
      };
    });
    const display: DisplayBlock[] = [];
    if (result.totals.length) {
      display.push({
        kind: "kpis",
        title: "Totales del filtro",
        items: result.totals.flatMap((t) => [
          { label: `Aprobado ${t.currency}`, value: money(t.approvedMinor, t.currency), hint: `${t.approvedCount} pagos` },
          ...(t.failedCount ? [{ label: `Fallidos ${t.currency}`, value: String(t.failedCount) }] : []),
        ]),
      });
    }
    if (rows.length) {
      display.push({
        kind: "table",
        title: "Pagos",
        columns: ["Fecha", "Persona", "Producto", "Importe", "Estado"],
        rows: rows.map((r) => [(r.paidAt ?? r.createdAt).slice(0, 10), r.contact, r.product, r.amount, r.status]),
      });
    }
    return {
      totals: result.totals.map((t) => ({ ...t, approved: money(t.approvedMinor, t.currency) })),
      payments: rows,
      hasMore: result.nextCursor !== null,
      display,
    };
  },
});
