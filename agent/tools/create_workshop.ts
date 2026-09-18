import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { generateWorkshopSlug, upsertWorkshopEdition } from "@/lib/crm/workshop-editions";
import { canOpenWithPrice, syncWorkshopEditionPrice } from "@/lib/crm/workshop-pricing";
import { validateWorkshopPrices } from "@/lib/crm/workshop-price-rows";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { siteUrl } from "@/lib/notifications/config";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Create a new workshop edition (taller). Only title is required — ask the operator about publishing status, price (COP required to open registrations, USD optional), capacity, and schedule before calling this; never invent them. Setting status to OPEN closes any other currently-open workshop. The result includes a public link only when status is OPEN — mention it to the operator in that case; don't mention the raw slug/id otherwise.",
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
    priceCop: z
      .number()
      .optional()
      .describe("Precio en pesos colombianos (entero, sin comisión — la comisión se suma al cobrar). Obligatorio para abrir inscripciones."),
    priceUsd: z
      .number()
      .optional()
      .describe("Precio en dólares (máximo 2 decimales, sin comisión). Opcional; sin él, fuera de Colombia no se puede pagar."),
    focusTopics: z.array(z.string().min(1).max(500)).optional().describe("Topics covered, shown as a list"),
    daySchedule: z
      .array(z.object({ startTime: z.string(), endTime: z.string(), title: z.string() }))
      .optional()
      .describe("Schedule slots, 24h HH:MM start/end times"),
  }),
  approval: always(),
  async execute({ priceCop, priceUsd, ...input }, ctx) {
    requireWriteStaff(ctx);
    const slug = await generateWorkshopSlug(input.title);
    if (isVirtualWorkshopSlug(slug)) {
      throw new Error("Ese título genera un slug reservado por el sistema — pide al operador un título distinto.");
    }
    const prices = validateWorkshopPrices({ priceCop, priceUsd });
    if (!prices.ok) {
      throw new Error("Precio inválido: pesos enteros mayores que cero y dólares con máximo dos decimales.");
    }
    if (
      input.status === "OPEN" &&
      !(await canOpenWithPrice(
        slug,
        prices.copPesos,
        prices.copPesos !== undefined || prices.usdCents !== undefined,
      ))
    ) {
      throw new Error("Para abrir inscripciones este taller necesita su precio en pesos (COP) — pídeselo al operador.");
    }
    const edition = await upsertWorkshopEdition(slug, input);
    await syncWorkshopEditionPrice({
      slug: edition.slug,
      title: edition.title,
      status: edition.status,
      copPesos: prices.copPesos,
      usdCents: prices.usdCents,
    });
    await auditAgentWrite(ctx, {
      action: "CREATE",
      entityType: "WorkshopEdition",
      entityId: edition.id,
      changes: { ...input, priceCop, priceUsd },
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
