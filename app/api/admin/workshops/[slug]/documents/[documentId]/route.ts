import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteWorkshopDocument } from "@/lib/crm/workshop-editions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { slug: string; documentId: string };

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { slug, documentId } = params;

  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!edition) return apiError("not_found", 404);

  const existing = await prisma.workshopDocument.findUnique({ where: { id: documentId } });
  if (!existing || existing.workshopEditionId !== edition.id) {
    return apiError("not_found", 404);
  }

  const doc = await deleteWorkshopDocument(documentId);
  if (!doc) return apiError("not_found", 404);

  try {
    await del(doc.url);
  } catch {
    /* blob may already be gone — best-effort */
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "WorkshopDocument",
    entityId: doc.id,
    changes: { workshopEditionId: doc.workshopEditionId, filename: doc.filename },
  });

  return NextResponse.json({ ok: true });
});
