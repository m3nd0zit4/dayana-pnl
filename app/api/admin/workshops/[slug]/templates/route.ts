import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { listWorkshopTemplates, submitWorkshopTemplates } from "@/lib/crm/workshop-templates";
import { WORKSHOP_TEMPLATE_KEYS } from "@/lib/crm/workshop-templates-rules";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { slug: string };

const schema = z.object({
  action: z.literal("submit"),
  /** Sin `keys`: todas las del taller que falten (nunca mandadas o rechazadas). */
  keys: z.array(z.enum(WORKSHOP_TEMPLATE_KEYS)).min(1).max(WORKSHOP_TEMPLATE_KEYS.length).optional(),
});

/**
 * «Mandar a aprobar» las plantillas de WhatsApp del taller (la del registro en
 * la página y la de la invitación a inscritas de eventos gratuitos), desde
 * «Interesadas» (29-oct). Solo la dueña: lo que sale a Meta con ellas se cobra.
 * Cada intento queda en la auditoría (`submitWorkshopTemplates`). Devuelve el
 * resultado de cada una y su estado al día.
 */
export const POST = withStaff<Params>("owner", async ({ req, staff, params }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const edition = await prisma.workshopEdition.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!edition) return apiError("not_found", 404);
  const results = await submitWorkshopTemplates({ staffId: staff.id, editionId: edition.id, keys: parsed.data.keys, via: "taller" });
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0 && failed.length === results.filter((r) => r.status !== "already").length) {
    const first = failed[0];
    return apiError("template_failed", 502, {
      message: `Meta no recibió la plantilla: ${first.status === "failed" ? first.error : ""}`.trim(),
      results,
    });
  }
  return NextResponse.json({ results, templates: await listWorkshopTemplates() });
});
