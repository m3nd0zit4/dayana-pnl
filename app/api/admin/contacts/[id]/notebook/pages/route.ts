import { NextRequest, NextResponse } from "next/server";
import { NotebookPageKind } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createNotebookPage,
  listNotebookPages,
  reorderNotebookPages,
} from "@/lib/crm/contact-notebook";
import { canEditClinicalNotes } from "@/lib/crm/staff";
import {
  createNotebookPageSchema,
  reorderNotebookPagesSchema,
} from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId } = await ctx.params;
  const pages = await listNotebookPages(contactId);
  return NextResponse.json({ pages });
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = createNotebookPageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const page = await createNotebookPage({
      contactId,
      title: parsed.data.title,
      kind: parsed.data.kind as NotebookPageKind | undefined,
      background: parsed.data.background,
      therapySessionId: parsed.data.therapySessionId,
      enrollmentId: parsed.data.enrollmentId,
      createdByStaffId: staff.id,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "ContactNotebookPage",
      entityId: page.id,
    });

    return NextResponse.json({ page });
  } catch (e) {
    if (e instanceof Error && e.message === "PAGE_LIMIT_REACHED") {
      return NextResponse.json({ error: "page_limit_reached" }, { status: 409 });
    }
    throw e;
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = reorderNotebookPagesSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const pages = await reorderNotebookPages(contactId, parsed.data.orderedIds);
    return NextResponse.json({ pages });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_ORDER") {
      return NextResponse.json({ error: "invalid_order" }, { status: 400 });
    }
    throw e;
  }
}
