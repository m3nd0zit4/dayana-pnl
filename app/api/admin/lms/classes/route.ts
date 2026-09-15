import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createLiveClass,
  getCourseModuleProductId,
  listClassesForModule,
  listLiveClassesAdmin,
  listUnassignedClasses,
  requireCourseProduct,
} from "@/lib/lms/course-admin";
import { liveClassSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async ({ req }) => {
  const moduleId = req.nextUrl.searchParams.get("moduleId");
  if (moduleId) {
    const rows = await listClassesForModule(moduleId);
    const classes = rows.map(({ _count, ...row }) => ({
      ...row,
      commentCount: _count.comments,
    }));
    return NextResponse.json({ classes });
  }

  const course = await requireCourseProduct(
    req.nextUrl.searchParams.get("productId")
  ).catch(() => null);
  if (!course) {
    return apiError("no_course_product", 404);
  }

  if (req.nextUrl.searchParams.get("unassigned") === "1") {
    const classes = await listUnassignedClasses(course.id);
    return NextResponse.json({ classes });
  }

  const classes = await listLiveClassesAdmin(course.id);
  return NextResponse.json({ classes });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = liveClassSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  // El curso sale del módulo destino: así una clase nunca puede nacer colgada
  // de un producto distinto al del módulo que la contiene.
  const parentModule = parsed.data.moduleId
    ? await getCourseModuleProductId(parsed.data.moduleId)
    : null;
  const course = await requireCourseProduct(parentModule).catch(() => null);
  if (!course) {
    return apiError("no_course_product", 404);
  }

  const liveClass = await createLiveClass({
    productId: course.id,
    moduleId: parsed.data.moduleId,
    title: parsed.data.title,
    description: parsed.data.description,
    scheduledAt: parsed.data.scheduledAt
      ? new Date(parsed.data.scheduledAt)
      : null,
    meetUrl: parsed.data.meetUrl,
    recordingUrl: parsed.data.recordingUrl,
    contentType: parsed.data.contentType,
    bodyMd: parsed.data.bodyMd,
    quizJson: parsed.data.quizJson,
    evergreen: parsed.data.evergreen,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "LiveClassSession",
    entityId: liveClass.id,
  });

  return NextResponse.json({ liveClass });
});
