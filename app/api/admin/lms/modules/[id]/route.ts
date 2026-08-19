import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  deleteCourseModule,
  updateCourseModule,
} from "@/lib/lms/course-admin";
import { courseModuleSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const parsed = courseModuleSchema
    .partial()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // `productId` viaja en el schema para la creación; mover un módulo de curso
  // no se hace por aquí (arrastraría clases y progreso a otro producto).
  const { productId: _productId, ...data } = parsed.data;
  const courseModule = await updateCourseModule(id, data).catch(() => null);
  if (!courseModule) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "CourseModule",
    entityId: id,
    changes: parsed.data,
  });

  return NextResponse.json({ module: courseModule });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const deleted = await deleteCourseModule(id).catch(() => null);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "CourseModule",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
