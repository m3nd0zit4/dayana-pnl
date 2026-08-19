import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listCoursesAdmin } from "@/lib/lms/course-admin";
import { listRecentCommentsForProduct } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  // Una sola bandeja para toda la biblioteca: un comentario sin responder no
  // debería esconderse porque está en otro curso.
  const courses = await listCoursesAdmin();
  if (courses.length === 0) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const comments = await listRecentCommentsForProduct(courses.map((c) => c.id));
  return NextResponse.json({ comments });
}
