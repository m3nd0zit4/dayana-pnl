import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createCourseModule,
  listCourseModulesAdmin,
  requireCourseProduct,
} from "@/lib/lms/course-admin";
import { courseModuleSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const course = await requireCourseProduct().catch(() => null);
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const modules = await listCourseModulesAdmin(course.id);
  return NextResponse.json({ modules });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = courseModuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const course = await requireCourseProduct().catch(() => null);
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const courseModule = await createCourseModule({
    productId: course.id,
    ...parsed.data,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "CourseModule",
    entityId: courseModule.id,
  });

  return NextResponse.json({ module: courseModule });
}
