import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { listCoursesAdmin } from "@/lib/lms/course-admin";
import { listRecentCommentsForProduct } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  // Una sola bandeja para toda la biblioteca: un comentario sin responder no
  // debería esconderse porque está en otro curso.
  const courses = await listCoursesAdmin();
  if (courses.length === 0) {
    return apiError("no_course_product", 404);
  }

  const comments = await listRecentCommentsForProduct(courses.map((c) => c.id));
  return NextResponse.json({ comments });
});
