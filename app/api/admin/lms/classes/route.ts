import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createLiveClass,
  listLiveClassesAdmin,
  requireCourseProduct,
} from "@/lib/lms/course-admin";
import { liveClassSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const course = await requireCourseProduct().catch(() => null);
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const classes = await listLiveClassesAdmin(course.id);
  return NextResponse.json({ classes });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = liveClassSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const course = await requireCourseProduct().catch(() => null);
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const liveClass = await createLiveClass({
    productId: course.id,
    title: parsed.data.title,
    description: parsed.data.description,
    scheduledAt: parsed.data.scheduledAt
      ? new Date(parsed.data.scheduledAt)
      : null,
    meetUrl: parsed.data.meetUrl,
    recordingUrl: parsed.data.recordingUrl,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "LiveClassSession",
    entityId: liveClass.id,
  });

  return NextResponse.json({ liveClass });
}
