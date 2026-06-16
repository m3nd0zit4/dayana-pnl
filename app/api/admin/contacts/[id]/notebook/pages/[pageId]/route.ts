import { NextRequest, NextResponse } from "next/server";
import { NotebookPageBackground } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  deleteNotebookPage,
  getNotebookPage,
  updateNotebookPage,
} from "@/lib/crm/contact-notebook";
import { canEditClinicalNotes } from "@/lib/crm/staff";
import { updateNotebookPageSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; pageId: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId, pageId } = await ctx.params;
  const page = await getNotebookPage(pageId, contactId);
  if (!page) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ page });
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId, pageId } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = updateNotebookPageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const page = await updateNotebookPage(pageId, contactId, {
      title: parsed.data.title,
      background: parsed.data.background as NotebookPageBackground | undefined,
      canvasData: parsed.data.canvasData,
      bodyText: parsed.data.bodyText,
      therapySessionId: parsed.data.therapySessionId,
      enrollmentId: parsed.data.enrollmentId,
      attachmentUrl: parsed.data.attachmentUrl,
      attachmentMime: parsed.data.attachmentMime,
      attachmentName: parsed.data.attachmentName,
    });

    if (!page) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "ContactNotebookPage",
      entityId: pageId,
    });

    return NextResponse.json({ page });
  } catch (e) {
    if (e instanceof Error && e.message === "CANVAS_TOO_LARGE") {
      return NextResponse.json({ error: "canvas_too_large" }, { status: 413 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId, pageId } = await ctx.params;
  const ok = await deleteNotebookPage(pageId, contactId);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "ContactNotebookPage",
    entityId: pageId,
  });

  return NextResponse.json({ ok: true });
}
