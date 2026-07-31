import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWorkshopEditionBySlug, listWorkshopDocuments } from "@/lib/crm/workshop-editions";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "List the downloadable documents (PDFs, handouts) already attached to a workshop edition. Read-only — uploading a new document must be done by a human in the admin panel (/admin/talleres); the agent cannot receive file bytes, so this tool only reports what's already there.",
  inputSchema: z.object({
    slug: z.string().min(1).describe("Workshop edition slug — get one from list_workshop_editions"),
  }),
  async execute({ slug }, ctx) {
    requireStaff(ctx);
    const edition = await getWorkshopEditionBySlug(slug);
    if (!edition) {
      return { found: false as const };
    }
    const documents = await listWorkshopDocuments(edition.id);
    return {
      found: true as const,
      documents: documents.map((d) => ({
        filename: d.filename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
      })),
    };
  },
});
