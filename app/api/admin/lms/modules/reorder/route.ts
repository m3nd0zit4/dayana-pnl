import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  reorderCourseModules,
  requireCourseProduct,
} from "@/lib/lms/course-admin";
import { reorderCourseModulesSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = reorderCourseModulesSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  const course = await requireCourseProduct(parsed.data.productId).catch(
    () => null
  );
  if (!course) {
    return apiError("no_course_product", 404);
  }

  await reorderCourseModules(course.id, parsed.data.orderedIds);

  fireAuditLog({
    staffUserId: staff.id,
    action: "REORDER",
    entityType: "CourseModule",
    entityId: course.id,
  });

  return NextResponse.json({ ok: true });
});
