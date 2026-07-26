import { defineTool } from "eve/tools";
import { z } from "zod";
import { listWorkshopEditionsAdmin } from "@/lib/crm/workshop-editions";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "List every workshop edition (talleres) with its status, slug, and capacity. Use before creating one to check whether another is already OPEN.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const editions = await listWorkshopEditionsAdmin();
    return {
      editions: editions.map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        status: e.status,
        capacity: e.capacity,
        startsAt: e.startsAt?.toISOString() ?? null,
        productId: e.productId,
      })),
    };
  },
});
