import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import type { DisplayBlock } from "@/agent/lib/display";
import { getPendientes } from "@/lib/crm/pendientes";
import { prisma } from "@/lib/db";

export default defineTool({
  description:
    "What needs the team now — the same list as the dashboard's «Pendientes» plus WhatsApp receipts Dayana confirmed whose payment was never recorded: payments nobody could match to a person, memberships expired or expiring this week, payment links sent and unpaid, diagnostics without a purchase, prices out of sync with PayPal/Mercado Pago, WhatsApp chats waiting for Dayana («Te toca») and unanswered inbox threads. Use it for '¿qué tengo pendiente?' / '¿qué me toca hoy?'.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const [pendientes, unregistered] = await Promise.all([
      getPendientes(),
      // Receipts Dayana confirmed whose payment was never recorded: money that is
      // missing from sales until someone registers it.
      prisma.whatsAppPaymentReceipt.count({ where: { status: "confirmed", paymentId: null, paymentDismissedAt: null } }),
    ]);
    const items = [
      ...pendientes,
      ...(unregistered > 0
        ? [
            {
              key: "comprobantes-sin-registrar",
              count: unregistered,
              label: `${unregistered} ${unregistered === 1 ? "comprobante confirmado sin pago registrado" : "comprobantes confirmados sin pago registrado"}`,
              href: "/admin/whatsapp",
              tone: "alert" as const,
            },
          ]
        : []),
    ].filter((p) => p.count > 0);
    const display: DisplayBlock[] = items.length
      ? [
          {
            kind: "table",
            title: "Pendientes",
            columns: ["", "Cuántos"],
            rows: items.map((p) => [p.label, p.count]),
          },
        ]
      : [];
    return {
      pending: items.map((p) => ({ what: p.label, count: p.count, urgent: p.tone === "alert", href: p.href })),
      display,
    };
  },
});
