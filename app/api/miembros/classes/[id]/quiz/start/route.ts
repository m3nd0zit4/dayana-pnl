import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { getQuizState, startQuizAttempt } from "@/lib/lms/quiz";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Reclama un intento y arranca el reloj **en el servidor**. El cliente solo
 * recibe la fecha de vencimiento para pintar la cuenta atrás; adelantar el
 * reloj del navegador no compra tiempo, porque la validación de la hora ocurre
 * al calificar.
 */
export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const member = await getPortalViewer();
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cls = await prisma.liveClassSession.findUnique({
    where: { id },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished || cls.contentType !== "QUIZ" || !cls.quizJson) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const courses = await getEnrolledCourses(member.contact.id, {
    isOwner: member.isOwner,
  });
  const course = courses.find((c) => c.product.id === cls.productId);
  if (!course?.membership.isCurrent) {
    return NextResponse.json({ error: "membership_inactive" }, { status: 403 });
  }

  const started = await startQuizAttempt(id, member.contact.id, cls.quizJson);
  if (!started.ok) {
    return NextResponse.json({ error: started.reason }, { status: 409 });
  }

  const state = await getQuizState(id, member.contact.id, cls.quizJson);
  return NextResponse.json({
    attemptId: started.attemptId,
    endsAt: started.endsAt,
    state,
  });
}
