import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWorkshopEditionBySlug } from "@/lib/crm/workshop-editions";
import { siteUrl } from "@/lib/notifications/config";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description: "Get full detail for one workshop edition by slug, including its linked product and prices if any.",
  inputSchema: z.object({
    slug: z.string().min(1).describe("Workshop edition slug — get one from list_workshop_editions"),
  }),
  async execute({ slug }, ctx) {
    requireStaff(ctx);
    const edition = await getWorkshopEditionBySlug(slug);
    if (!edition) {
      return { found: false as const };
    }
    return {
      found: true as const,
      edition: {
        slug: edition.slug,
        title: edition.title,
        editionLabel: edition.editionLabel,
        cardSummary: edition.cardSummary,
        status: edition.status,
        dateLabel: edition.dateLabel,
        scheduleLabel: edition.scheduleLabel,
        capacity: edition.capacity,
        startsAt: edition.startsAt?.toISOString() ?? null,
        focusTopics: edition.focusTopics,
        daySchedule: edition.daySchedule,
        link: edition.status === "OPEN" ? `${siteUrl()}/taller-virtual/${edition.slug}` : null,
        product: edition.product
          ? {
              id: edition.product.id,
              title: edition.product.title,
              prices: edition.product.prices.map((p) => ({ currency: p.currency, amountMinor: p.amountMinor })),
            }
          : null,
      },
    };
  },
});
