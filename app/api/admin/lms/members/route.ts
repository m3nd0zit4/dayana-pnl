import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listCourseMembersAdmin } from "@/lib/lms/course-admin";
import { getMembershipProduct } from "@/lib/lms/membership";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  // Los miembros se inscriben a la mensualidad, no a cada curso: la lista sale
  // del producto de la membresía, no del primer curso de la biblioteca.
  const membership = await getMembershipProduct();
  if (!membership) {
    return NextResponse.json({ error: "no_course_product" }, { status: 404 });
  }

  const members = await listCourseMembersAdmin(membership.id);
  return NextResponse.json({ members, courseTitle: membership.title });
}
