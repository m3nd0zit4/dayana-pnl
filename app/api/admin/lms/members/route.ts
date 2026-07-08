import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  listCourseMembersAdmin,
  requireCourseProduct,
} from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const course = await requireCourseProduct().catch(() => null);
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const members = await listCourseMembersAdmin(course.id);
  return NextResponse.json({ members, courseTitle: course.title });
}
