import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { offerWorkshopCall } from "@/lib/crm/workshop-interest-offer";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { slug: string; interestId: string };

/**
 * «Ofrecerle la llamada»: la IA le escribe por el taller con horas para la
 * llamada con Dayana (o la plantilla, fuera de las 24 h). Devuelve si salió y,
 * si no, por qué.
 */
export const POST = withStaff<Params>("write", async ({ staff, params }) => {
  const { slug, interestId } = params;
  const edition = await prisma.workshopEdition.findUnique({ where: { slug }, select: { id: true } });
  if (!edition) return apiError("not_found", 404);

  const result = await offerWorkshopCall({ editionId: edition.id, interestId, staffId: staff.id });
  if (result.status === "skipped" && result.reason === "not_found") return apiError("not_found", 404);

  fireAuditLog({
    staffUserId: staff.id,
    action: "WHATSAPP_SENT",
    entityType: "WorkshopInterest",
    entityId: interestId,
    changes: {
      workshopEditionId: edition.id,
      source: "asistente:taller",
      status: result.status,
      ...(result.status === "sent" ? { via: result.via, slots: result.slots } : {}),
      ...(result.status === "skipped" ? { reason: result.reason } : {}),
    },
  });
  return NextResponse.json(
    result.status === "sent"
      ? { ok: true, via: result.via, slots: result.slots, offeredAt: result.at.toISOString() }
      : result.status === "skipped"
        ? { ok: false, reason: result.reason, detail: result.detail ?? null }
        : { ok: false, reason: "failed", detail: result.error },
    { status: result.status === "failed" ? 502 : 200 }
  );
});
