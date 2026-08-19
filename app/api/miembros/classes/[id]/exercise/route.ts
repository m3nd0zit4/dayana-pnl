import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import { getEnrolledCourses } from "@/lib/lms/membership";
import { markClassComplete } from "@/lib/lms/class-progress";
import {
  getExerciseAnswers,
  isExerciseComplete,
  readExercise,
  saveExerciseAnswers,
  type ExerciseAnswers,
} from "@/lib/lms/exercise";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const resolveExerciseClass = async (classId: string) => {
  const member = await getPortalViewer();
  if (!member) return { error: "unauthorized" as const, status: 401 };

  const cls = await prisma.liveClassSession.findUnique({
    where: { id: classId },
    include: { module: true },
  });
  if (!cls || !cls.module?.isPublished || cls.contentType !== "EXERCISE") {
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

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const resolved = await resolveExerciseClass(id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const answers = await getExerciseAnswers(id, resolved.member.contact.id);
  return NextResponse.json({ answers });
}

/**
 * Autoguardado. Se llama con debounce mientras la persona escribe, así que
 * sobrescribe siempre y no versiona nada.
 */
export async function PUT(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const resolved = await resolveExerciseClass(id);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { member, cls } = resolved;

  const body = (await req.json().catch(() => null)) as {
    answers?: ExerciseAnswers;
  } | null;
  if (!body?.answers || typeof body.answers !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Recorte defensivo: el cuaderno no es un sitio donde subir un libro.
  const answers: ExerciseAnswers = {};
  for (const [key, value] of Object.entries(body.answers)) {
    if (typeof value === "string") answers[key.slice(0, 100)] = value.slice(0, 5000);
  }

  await saveExerciseAnswers(id, member.contact.id, answers);

  // El ejercicio se marca solo: cuando todo lo obligatorio está escrito, está
  // hecho. Pedir además un clic en «completar» sería pedir dos veces lo mismo.
  const exercise = readExercise(cls.exerciseJson);
  const complete = exercise ? isExerciseComplete(exercise, answers) : false;
  if (complete) await markClassComplete(member.contact.id, id);

  return NextResponse.json({ ok: true, complete });
}
