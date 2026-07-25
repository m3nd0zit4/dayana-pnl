import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { updateWorkshopEditionBySlug } from "@/lib/crm/workshop-editions";
import { siteUrl } from "@/lib/notifications/config";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Edit an existing workshop edition by slug. Every field except slug and title is optional and only overwrites what you pass — title must always be included (pass the current one unchanged if you're not renaming it; get it from get_workshop_edition first). Setting status to OPEN closes any other currently-open workshop. The result includes a public link only when status is OPEN — mention it to the operator in that case; don't mention the raw slug/id otherwise.",
  inputSchema: z.object({
    slug: z.string().min(1),
    title: z.string().min(1).max(200),
    cardSummary: z.string().max(5000).optional(),
    status: z.enum(["DRAFT", "OPEN", "CLOSED", "COMPLETED"]).optional(),
    editionLabel: z.string().max(120).optional(),
    dateLabel: z.string().max(200).optional(),
    scheduleLabel: z.string().max(200).optional(),
    capacity: z.number().int().min(0).optional(),
    productId: z.string().nullable().optional().describe("Set to null to unlink the current product"),
    focusTopics: z.array(z.string().min(1).max(500)).optional(),
    daySchedule: z
      .array(z.object({ startTime: z.string(), endTime: z.string(), title: z.string() }))
      .optional(),
  }),
  approval: always(),
  async execute({ slug, ...rest }, ctx) {
    requireWriteStaff(ctx);
    const edition = await updateWorkshopEditionBySlug(slug, rest);
    await auditAgentWrite(ctx, {
      action: "UPDATE",
      entityType: "WorkshopEdition",
      entityId: edition.id,
      changes: rest,
    });
    return {
      edition: {
        slug: edition.slug,
        title: edition.title,
        status: edition.status,
        capacity: edition.capacity,
        link: edition.status === "OPEN" ? `${siteUrl()}/taller-virtual/${edition.slug}` : null,
      },
    };
  },
});
