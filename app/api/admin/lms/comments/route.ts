import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { requireCourseProduct } from "@/lib/lms/course-admin";
import { listRecentCommentsForProduct } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const course = await requireCourseProduct().catch(() => null);
  if (!course) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const comments = await listRecentCommentsForProduct(course.id);
  return NextResponse.json({ comments });
}
