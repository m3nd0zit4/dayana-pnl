import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { writeAuditLog } from "@/lib/crm/audit";
import { deleteContactNote, updateContactNote } from "@/lib/crm/contact-notes";
import { canEditClinicalNotes } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId, noteId } = await ctx.params;
  const body = await req.json().catch(() => null);

  const note = await updateContactNote(noteId, contactId, {
    title: body?.title,
    bodyText: body?.bodyText,
  });

  if (!note) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await writeAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "ContactNote",
    entityId: noteId,
    changes: body,
  });

  return NextResponse.json({ note });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId, noteId } = await ctx.params;
  const ok = await deleteContactNote(noteId, contactId);

  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await writeAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "ContactNote",
    entityId: noteId,
  });

  return NextResponse.json({ ok: true });
}
