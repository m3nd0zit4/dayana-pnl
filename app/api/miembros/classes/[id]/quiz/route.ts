import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { markClassComplete } from "@/lib/lms/class-progress";
import type { QuizJson } from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const member = await getPortalViewer();
  if (!member) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  const body = (await req.json().catch(() => null)) as {
    answers?: Record<string, string>;
  } | null;
  const answers = body?.answers ?? {};

  // Server-side grading — the client only ever receives question/option text,
  // never the `correct` flags, so this is the one place a score is computed.
  const quiz = cls.quizJson as unknown as QuizJson;
  const results: Record<string, boolean> = {};
  let score = 0;
  for (const question of quiz.questions) {
    const selectedOptionId = answers[question.id];
    const correctOption = question.options.find((o) => o.correct);
    const isCorrect = Boolean(selectedOptionId && selectedOptionId === correctOption?.id);
    results[question.id] = isCorrect;
    if (isCorrect) score += 1;
  }

  // Submitting is the completion signal for a quiz/survey — there's no
  // separate "marcar como completada" action for this content type.
  await markClassComplete(member.contact.id, id);

  return NextResponse.json({ score, total: quiz.questions.length, results });
}
