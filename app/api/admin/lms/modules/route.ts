import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createCourseModule,
  listCourseModulesAdmin,
  requireCourseProduct,
} from "@/lib/lms/course-admin";
import { courseModuleSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async ({ req }) => {
  const course = await requireCourseProduct(
    req.nextUrl.searchParams.get("productId")
  ).catch(() => null);
  if (!course) {
    return apiError("no_course_product", 404);
  }

  const modules = await listCourseModulesAdmin(course.id);
  return NextResponse.json({ modules });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = courseModuleSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  const { productId, ...moduleInput } = parsed.data;
  const course = await requireCourseProduct(productId).catch(() => null);
  if (!course) {
    return apiError("no_course_product", 404);
  }

  const courseModule = await createCourseModule({
    productId: course.id,
    ...moduleInput,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "CourseModule",
    entityId: courseModule.id,
  });

  return NextResponse.json({ module: courseModule });
});
