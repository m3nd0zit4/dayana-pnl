import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteLiveClass, updateLiveClass } from "@/lib/lms/course-admin";
import { liveClassSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  const parsed = liveClassSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
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
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: parsed.data,
  });

  return NextResponse.json({ liveClass });
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { id } = params;
  const deleted = await deleteLiveClass(id).catch(() => null);
  if (!deleted) {
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "LiveClassSession",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
});
