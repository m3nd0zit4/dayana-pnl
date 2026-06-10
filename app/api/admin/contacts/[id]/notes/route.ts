import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createContactNote,
  deleteContactNote,
  listContactNotes,
  updateContactNote,
} from "@/lib/crm/contact-notes";
import { canEditClinicalNotes } from "@/lib/crm/staff";
import { ContactNoteKind } from "@prisma/client";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: contactId } = await ctx.params;
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const result = await listContactNotes(contactId, { cursor, limit });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canEditClinicalNotes(staff.role)) {
    return NextResponse.json({ error: "forbidden_notes" }, { status: 403 });
  }

  const { id: contactId } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const kind =
    body.kind === ContactNoteKind.HANDWRITTEN
      ? ContactNoteKind.HANDWRITTEN
      : ContactNoteKind.TEXT;

  if (kind === ContactNoteKind.TEXT && !body.bodyText?.trim() && !body.title?.trim()) {
    return NextResponse.json({ error: "missing_content" }, { status: 400 });
  }

  if (kind === ContactNoteKind.HANDWRITTEN && !body.attachmentUrl) {
    return NextResponse.json({ error: "missing_attachment" }, { status: 400 });
  }

  const note = await createContactNote({
    contactId,
    kind,
    title: body.title ?? null,
    bodyText: body.bodyText ?? null,
    therapySessionId: body.therapySessionId ?? null,
    enrollmentId: body.enrollmentId ?? null,
    attachmentUrl: body.attachmentUrl ?? null,
    attachmentMime: body.attachmentMime ?? null,
    attachmentName: body.attachmentName ?? null,
    createdByStaffId: staff.id,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "ContactNote",
    entityId: note.id,
  });

  return NextResponse.json({ note });
}
