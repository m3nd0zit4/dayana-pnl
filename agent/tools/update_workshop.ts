import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { updateWorkshopEditionBySlug } from "@/lib/crm/workshop-editions";
import { canOpenWithPrice, syncWorkshopEditionPrice } from "@/lib/crm/workshop-pricing";
import { validateWorkshopPrices } from "@/lib/crm/workshop-price-rows";
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
    priceCop: z
      .number()
      .optional()
      .describe("Precio en pesos colombianos (entero, sin comisión — la comisión se suma al cobrar). Obligatorio para abrir inscripciones."),
    priceUsd: z
      .number()
      .optional()
      .describe("Precio en dólares (máximo 2 decimales, sin comisión). Opcional; sin él, fuera de Colombia no se puede pagar."),
    focusTopics: z.array(z.string().min(1).max(500)).optional(),
    daySchedule: z
      .array(z.object({ startTime: z.string(), endTime: z.string(), title: z.string() }))
      .optional(),
  }),
  approval: always(),
  async execute({ slug, priceCop, priceUsd, ...rest }, ctx) {
    requireWriteStaff(ctx);
    const prices = validateWorkshopPrices({ priceCop, priceUsd });
    if (!prices.ok) {
      throw new Error("Precio inválido: pesos enteros mayores que cero y dólares con máximo dos decimales.");
    }
    if (
      rest.status === "OPEN" &&
      !(await canOpenWithPrice(
        slug,
        prices.copPesos,
        prices.copPesos !== undefined || prices.usdCents !== undefined,
      ))
    ) {
      throw new Error("Para abrir inscripciones este taller necesita su precio en pesos (COP) — pídeselo al operador.");
    }
    const edition = await updateWorkshopEditionBySlug(slug, rest);
    await syncWorkshopEditionPrice({
      slug: edition.slug,
      title: edition.title,
      status: edition.status,
      copPesos: prices.copPesos,
      usdCents: prices.usdCents,
    });
    await auditAgentWrite(ctx, {
      action: "UPDATE",
      entityType: "WorkshopEdition",
      entityId: edition.id,
      changes: { ...rest, priceCop, priceUsd },
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
