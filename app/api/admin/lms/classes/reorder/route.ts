import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { reorderCourseClasses } from "@/lib/lms/course-admin";
import { reorderCourseClassesSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = reorderCourseClassesSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  await reorderCourseClasses(parsed.data.moduleId, parsed.data.orderedIds);

  fireAuditLog({
    staffUserId: staff.id,
    action: "REORDER",
    entityType: "LiveClassSession",
    entityId: parsed.data.moduleId,
  });

  return NextResponse.json({ ok: true });
});
