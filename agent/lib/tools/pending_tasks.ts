import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import type { DisplayBlock } from "@/agent/lib/display";
import { getPendientes } from "@/lib/crm/pendientes";

export default defineTool({
  description:
    "What needs the team now — the same list as the dashboard's «Pendientes»: payments nobody could match to a person, memberships expired or expiring this week, payment links sent and unpaid, diagnostics without a purchase, prices out of sync with PayPal/Mercado Pago, WhatsApp chats waiting for Dayana («Te toca») and unanswered inbox threads. Use it for '¿qué tengo pendiente?' / '¿qué me toca hoy?'.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const items = (await getPendientes()).filter((p) => p.count > 0);
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
