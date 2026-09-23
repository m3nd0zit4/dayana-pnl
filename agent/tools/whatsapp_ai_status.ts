import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { getOverview } from "@/lib/crm/whatsapp-agent/workspace";

export default defineTool({
  description:
    "How the WhatsApp AI is doing: whether it is on and connected, what it did in the last 24 hours (replied, drafts, handed to Dayana, bookings, failures, average time) and its latest decisions with the reason for each. Use it for questions like how did today go, why did it not answer someone, or is everything connected.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const o = await getOverview();
    return {
      enabled: o.enabled,
      last24h: o.kpis,
      health: o.health,
      recent: o.runs.slice(0, 30).map((r) => ({
        chat: r.name,
        conversationId: r.conversationId,
        status: r.status,
        reason: r.reason,
        category: r.category,
        severity: r.severity,
        at: r.queuedAt,
        seconds: r.latencyMs ? Math.round(r.latencyMs / 1000) : null,
      })),
    };
  },
});
