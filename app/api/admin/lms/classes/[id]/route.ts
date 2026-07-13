import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteLiveClass, updateLiveClass } from "@/lib/lms/course-admin";
import { liveClassSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const parsed = liveClassSchema
    .partial()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // moduleId moves through the dedicated /assign endpoint (it also has to
  // pick a sortOrder within the target module) — never through this general
  // content-fields update.
  const { scheduledAt, moduleId: _moduleId, ...rest } = parsed.data;
  const liveClass = await updateLiveClass(id, {
    ...rest,
    ...(scheduledAt !== undefined
      ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }
      : {}),
  }).catch(() => null);

  if (!liveClass) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: parsed.data,
  });

  return NextResponse.json({ liveClass });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const deleted = await deleteLiveClass(id).catch(() => null);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "LiveClassSession",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
