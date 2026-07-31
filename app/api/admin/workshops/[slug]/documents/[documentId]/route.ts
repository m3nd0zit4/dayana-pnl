import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteWorkshopDocument } from "@/lib/crm/workshop-editions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; documentId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { slug, documentId } = await ctx.params;

  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await prisma.workshopDocument.findUnique({ where: { id: documentId } });
  if (!existing || existing.workshopEditionId !== edition.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const doc = await deleteWorkshopDocument(documentId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
}
