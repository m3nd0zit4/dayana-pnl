import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  deleteCourseModule,
  updateCourseModule,
} from "@/lib/lms/course-admin";
import { courseModuleSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  const parsed = courseModuleSchema
    .partial()
    .safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  // `productId` viaja en el schema para la creación; mover un módulo de curso
  // no se hace por aquí (arrastraría clases y progreso a otro producto).
  const { productId: _productId, ...data } = parsed.data;
  const courseModule = await updateCourseModule(id, data).catch(() => null);
  if (!courseModule) {
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "CourseModule",
    entityId: id,
    changes: parsed.data,
  });

  return NextResponse.json({ module: courseModule });
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { id } = params;
  const deleted = await deleteCourseModule(id).catch(() => null);
  if (!deleted) {
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "CourseModule",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
});
