import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { listCourseMembersAdmin } from "@/lib/lms/course-admin";
import { getMembershipProduct } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  // Los miembros se inscriben a la mensualidad, no a cada curso: la lista sale
  // del producto de la membresía, no del primer curso de la biblioteca.
  const membership = await getMembershipProduct();
  if (!membership) {
    return apiError("no_course_product", 404);
  }

  const members = await listCourseMembersAdmin(membership.id);
  return NextResponse.json({ members, courseTitle: membership.title });
});
