import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  reorderCourseModules,
  requireCourseProduct,
} from "@/lib/lms/course-admin";
import { reorderCourseModulesSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = reorderCourseModulesSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const course = await requireCourseProduct(parsed.data.productId).catch(
    () => null
  );
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  await reorderCourseModules(course.id, parsed.data.orderedIds);

  fireAuditLog({
    staffUserId: staff.id,
    action: "REORDER",
    entityType: "CourseModule",
    entityId: course.id,
  });

  return NextResponse.json({ ok: true });
}
