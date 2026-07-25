import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { generateWorkshopSlug, upsertWorkshopEdition } from "@/lib/crm/workshop-editions";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { siteUrl } from "@/lib/notifications/config";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Create a new workshop edition (taller). Only title is required — ask the operator about publishing status, payment (link or create a product), capacity, and schedule before calling this; never invent them. Setting status to OPEN closes any other currently-open workshop. The result includes a public link only when status is OPEN — mention it to the operator in that case; don't mention the raw slug/id otherwise.",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    cardSummary: z.string().max(5000).optional().describe("Short description shown on the workshop's card/page"),
    status: z
      .enum(["DRAFT", "OPEN", "CLOSED", "COMPLETED"])
      .optional()
      .describe("Defaults to DRAFT (unpublished). OPEN closes any other currently-open workshop — warn the operator first."),
    editionLabel: z.string().max(120).optional().describe("e.g. 'Edición 2026'"),
    dateLabel: z.string().max(200).optional().describe("Free-text display date, e.g. '16 de mayo de 2026' — not a parsed date"),
    scheduleLabel: z.string().max(200).optional().describe("Free-text schedule, e.g. '7:30 a.m. – 4:30 p.m. · virtual'"),
    capacity: z.number().int().min(0).optional().describe("0 or omitted = unlimited/not tracked"),
    productId: z.string().optional().describe("Existing WORKSHOP product id to link for online payment — get one from list_products, or create one first with create_workshop_product"),
    focusTopics: z.array(z.string().min(1).max(500)).optional().describe("Topics covered, shown as a list"),
    daySchedule: z
      .array(z.object({ startTime: z.string(), endTime: z.string(), title: z.string() }))
      .optional()
      .describe("Schedule slots, 24h HH:MM start/end times"),
  }),
  approval: always(),
  async execute(input, ctx) {
    requireWriteStaff(ctx);
    const slug = await generateWorkshopSlug(input.title);
    if (isVirtualWorkshopSlug(slug)) {
      throw new Error("Ese título genera un slug reservado por el sistema — pide al operador un título distinto.");
    }
    const edition = await upsertWorkshopEdition(slug, input);
    await auditAgentWrite(ctx, {
      action: "CREATE",
      entityType: "WorkshopEdition",
      entityId: edition.id,
      changes: input,
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
