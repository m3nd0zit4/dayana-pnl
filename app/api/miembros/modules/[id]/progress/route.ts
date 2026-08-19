import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";
import {
  markModuleComplete,
  markModuleIncomplete,
} from "@/lib/lms/module-progress";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const requireCurrentMember = async (moduleId: string) => {
  const member = await getPortalViewer();
  if (!member) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  // El curso se resuelve **desde el módulo**, no desde la inscripción. Antes se
  // usaba `membership.enrollment.product.id`, que con la membresía all-access es
  // el producto de la mensualidad y nunca el curso de la biblioteca: el módulo
  // no se encontraba y completar la introducción devolvía 404 siempre.
  const courseModule = await prisma.courseModule.findUnique({
    where: { id: moduleId },
    select: { id: true, productId: true, isPublished: true },
  });
  if (!courseModule?.isPublished) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  const courses = await getEnrolledCourses(member.contact.id, {
    isOwner: member.isOwner,
  });
  const course = courses.find((c) => c.product.id === courseModule.productId);
  if (!course?.membership.isCurrent) {
    return { error: NextResponse.json({ error: "membership_inactive" }, { status: 403 }) };
  }

  return { contactId: member.contact.id };
};

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  await markModuleComplete(result.contactId, id);
  return NextResponse.json({ ok: true, completed: true });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const result = await requireCurrentMember(id);
  if ("error" in result) return result.error;

  await markModuleIncomplete(result.contactId, id);
  return NextResponse.json({ ok: true, completed: false });
}
