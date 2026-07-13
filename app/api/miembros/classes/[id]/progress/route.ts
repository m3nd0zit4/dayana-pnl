import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMemberSession } from "@/lib/auth/member-session";
import { getEnrolledCourses } from "@/lib/lms/membership";
import {
  markClassComplete,
  markClassIncomplete,
} from "@/lib/lms/class-progress";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const requireCurrentMember = async (classId: string) => {
  const member = await getMemberSession();
  if (!member) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const cls = await prisma.liveClassSession.findUnique({
    where: { id: classId },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  const courses = await getEnrolledCourses(member.contact.id);
  const course = courses.find((c) => c.product.id === cls.productId);
  if (!course?.membership.isCurrent) {
    return {
      error: NextResponse.json({ error: "membership_inactive" }, { status: 403 }),
    };
  }

  return { contactId: member.contact.id };
};

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  await markClassComplete(result.contactId, id);
  return NextResponse.json({ ok: true, completed: true });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  await markClassIncomplete(result.contactId, id);
  return NextResponse.json({ ok: true, completed: false });
}
