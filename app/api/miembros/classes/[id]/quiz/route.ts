import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { markClassComplete } from "@/lib/lms/class-progress";
import { gradeQuizAttempt, getQuizState } from "@/lib/lms/quiz";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/** Carga la clase y comprueba que el visitante tenga acceso vigente al curso. */
const resolveQuizClass = async (classId: string) => {
  const member = await getPortalViewer();
  if (!member) return { error: "unauthorized" as const, status: 401 };

  const cls = await prisma.liveClassSession.findUnique({
    where: { id: classId },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished || cls.contentType !== "QUIZ" || !cls.quizJson) {
    return { error: "not_found" as const, status: 404 };
  }

  const courses = await getEnrolledCourses(member.contact.id, {
    isOwner: member.isOwner,
  });
  const course = courses.find((c) => c.product.id === cls.productId);
  if (!course?.membership.isCurrent) {
    return { error: "membership_inactive" as const, status: 403 };
  }

  return { member, cls };
};

/** Estado del cuestionario: intentos, nota mínima, tiempo y si hay uno abierto. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const resolved = await resolveQuizClass(id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const state = await getQuizState(id, resolved.member.contact.id, resolved.cls.quizJson);
  return NextResponse.json(state);
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const resolved = await resolveQuizClass(id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { member, cls } = resolved;

  const body = (await req.json().catch(() => null)) as {
    attemptId?: string;
    answers?: Record<string, string>;
  } | null;

  if (!body?.attemptId) {
    return NextResponse.json({ error: "attempt_required" }, { status: 400 });
  }

  const graded = await gradeQuizAttempt(
    body.attemptId,
    member.contact.id,
    cls.quizJson,
    body.answers ?? {}
  );
  if (!graded) {
    // El intento no existe, no es suyo o ya se envió: no se recalifica.
    return NextResponse.json({ error: "attempt_not_open" }, { status: 409 });
  }

  // La lección se marca completa al **aprobar**, no al enviar: un cuestionario
  // reprobado con intentos restantes sigue siendo trabajo pendiente.
  if (graded.passed) {
    await markClassComplete(member.contact.id, id);
  }

  const state = await getQuizState(id, member.contact.id, cls.quizJson);
  return NextResponse.json({ ...graded, state });
}
