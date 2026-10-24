import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { isInterestStatus, setWorkshopInterestStatus } from "@/lib/crm/workshop-interests";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { slug: string; interestId: string };

/** El seguimiento de una interesada en el taller (nuevo · contactada · inscrita · descartada). */
export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { slug, interestId } = params;
  const edition = await prisma.workshopEdition.findUnique({ where: { slug }, select: { id: true } });
  if (!edition) return apiError("not_found", 404);

  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  if (!isInterestStatus(body?.status)) return apiError("invalid_status", 400);

  const ok = await setWorkshopInterestStatus(edition.id, interestId, body.status);
  if (!ok) return apiError("not_found", 404);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WorkshopInterest",
    entityId: interestId,
    changes: { workshopEditionId: edition.id, status: body.status },
  });
  return NextResponse.json({ ok: true });
});
