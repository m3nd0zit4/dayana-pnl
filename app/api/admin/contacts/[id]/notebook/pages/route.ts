import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  consolidateContactCanvasPages,
  getOrCreateContactCanvas,
  listNotebookPages,
} from "@/lib/crm/contact-notebook";
import { canEditClinicalNotes } from "@/lib/crm/staff";
import { isBlobConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId } = await ctx.params;
  await consolidateContactCanvasPages(contactId);
  const pages = await listNotebookPages(contactId);
  return NextResponse.json({
    pages,
    blobConfigured: isBlobConfigured(),
  });
}

/** Get or create the single canvas page for this contact. */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId } = await ctx.params;

  const page = await getOrCreateContactCanvas({
    contactId,
    createdByStaffId: staff.id,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "ContactNotebookPage",
    entityId: page.id,
  });

  return NextResponse.json({ page, blobConfigured: isBlobConfigured() });
}
