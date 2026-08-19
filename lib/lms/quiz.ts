import { prisma } from "@/lib/db";
import type { QuizJson } from "./course-admin";

/**
 * Reglas de un cuestionario. Viven dentro de `quizJson` para no añadir columnas
 * por cada ajuste, y todas tienen un valor por defecto: un quiz autorizado sin
 * `config` se comporta como antes de que existieran los intentos.
 */
export type QuizConfig = {
  /** Minutos para responder desde que se pulsa «Empezar». 0 = sin límite. */
  timeLimitMin: number;
  /** Intentos permitidos. 0 = ilimitados. */
  maxAttempts: number;
  /** Porcentaje mínimo para aprobar. */
  passPercent: number;
};

export const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  timeLimitMin: 10,
  maxAttempts: 3,
  passPercent: 70,
};

/** Margen de gracia sobre el límite: cubre la latencia del envío y el reloj
 *  del cliente, que siempre va unos segundos por delante o por detrás. */
export const QUIZ_GRACE_SEC = 15;

export const readQuizConfig = (quizJson: unknown): QuizConfig => {
  const raw = (quizJson as { config?: Partial<QuizConfig> } | null)?.config;
  if (!raw) return DEFAULT_QUIZ_CONFIG;
  return {
    timeLimitMin: Math.max(0, Math.trunc(raw.timeLimitMin ?? DEFAULT_QUIZ_CONFIG.timeLimitMin)),
    maxAttempts: Math.max(0, Math.trunc(raw.maxAttempts ?? DEFAULT_QUIZ_CONFIG.maxAttempts)),
    passPercent: Math.min(
      100,
      Math.max(0, Math.trunc(raw.passPercent ?? DEFAULT_QUIZ_CONFIG.passPercent))
    ),
  };
};

export type QuizAttemptSummary = {
  id: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  total: number | null;
  passed: boolean | null;
};

export type QuizState = {
  config: QuizConfig;
  questionCount: number;
  attemptsUsed: number;
  attemptsLeft: number | null;
  bestScore: number | null;
  passed: boolean;
  /** Intento en curso (empezado y sin enviar), si el tiempo aún no venció. */
  openAttempt: { id: string; endsAt: string | null } | null;
  history: QuizAttemptSummary[];
};

const toSummary = (a: {
  id: string;
  startedAt: Date;
  submittedAt: Date | null;
  score: number | null;
  total: number | null;
  passed: boolean | null;
}): QuizAttemptSummary => ({
  id: a.id,
  startedAt: a.startedAt.toISOString(),
  submittedAt: a.submittedAt?.toISOString() ?? null,
  score: a.score,
  total: a.total,
  passed: a.passed,
});

const attemptDeadline = (startedAt: Date, config: QuizConfig): Date | null =>
  config.timeLimitMin > 0
    ? new Date(startedAt.getTime() + config.timeLimitMin * 60_000)
    : null;

/**
 * Estado del cuestionario para un alumno: cuántos intentos le quedan, si ya
 * aprobó y si tiene uno en curso. Es lo que la pantalla previa necesita para
 * decirle a qué se está metiendo antes de pulsar «Empezar».
 */
export const getQuizState = async (
  classId: string,
  contactId: string,
  quizJson: unknown
): Promise<QuizState> => {
  const config = readQuizConfig(quizJson);
  const questionCount = (quizJson as QuizJson | null)?.questions?.length ?? 0;

  const attempts = await prisma.quizAttempt.findMany({
    where: { classId, contactId },
    orderBy: { startedAt: "desc" },
  });

  const submitted = attempts.filter((a) => a.submittedAt != null);
  const attemptsUsed = submitted.length;
  const bestScore = submitted.reduce<number | null>(
    (best, a) => (a.score != null && (best == null || a.score > best) ? a.score : best),
    null
  );

  // Un intento abierto solo cuenta si todavía queda tiempo. Uno vencido no se
  // borra — se deja como intento gastado, que es lo que fue.
  const open = attempts.find((a) => a.submittedAt == null) ?? null;
  const openDeadline = open ? attemptDeadline(open.startedAt, config) : null;
  const openIsLive =
    open != null && (openDeadline == null || openDeadline.getTime() > Date.now());

  const consumed = attemptsUsed + (open ? 1 : 0);

  return {
    config,
    questionCount,
    attemptsUsed,
    attemptsLeft:
      config.maxAttempts === 0 ? null : Math.max(0, config.maxAttempts - consumed),
    bestScore,
    passed: submitted.some((a) => a.passed === true),
    openAttempt: openIsLive
      ? { id: open.id, endsAt: openDeadline?.toISOString() ?? null }
      : null,
    history: submitted.map(toSummary),
  };
};

export type StartQuizResult =
  | { ok: true; attemptId: string; endsAt: string | null }
  | { ok: false; reason: "no_attempts_left" | "already_passed" };

/**
 * Reclama un intento. Si ya hay uno abierto y vigente lo devuelve tal cual —
 * recargar la página no debe gastar un intento ni reiniciar el reloj.
 */
export const startQuizAttempt = async (
  classId: string,
  contactId: string,
  quizJson: unknown
): Promise<StartQuizResult> => {
  const state = await getQuizState(classId, contactId, quizJson);

  if (state.openAttempt) {
    return { ok: true, attemptId: state.openAttempt.id, endsAt: state.openAttempt.endsAt };
  }
  if (state.passed) return { ok: false, reason: "already_passed" };
  if (state.attemptsLeft != null && state.attemptsLeft <= 0) {
    return { ok: false, reason: "no_attempts_left" };
  }

  const attempt = await prisma.quizAttempt.create({
    data: { classId, contactId },
  });
  const deadline = attemptDeadline(attempt.startedAt, state.config);

  return {
    ok: true,
    attemptId: attempt.id,
    endsAt: deadline?.toISOString() ?? null,
  };
};

export type GradeResult = {
  score: number;
  total: number;
  passed: boolean;
  percent: number;
  results: Record<string, boolean>;
  /** Respuesta correcta de cada pregunta — solo se revela ya calificado. */
  correct: Record<string, string>;
  timedOut: boolean;
};

/**
 * Califica en el servidor. El cliente nunca ve las banderas `correct` antes de
 * enviar, así que este es el único lugar donde se conoce la nota.
 */
export const gradeQuizAttempt = async (
  attemptId: string,
  contactId: string,
  quizJson: unknown,
  answers: Record<string, string>
): Promise<GradeResult | null> => {
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId, contactId, submittedAt: null },
  });
  if (!attempt) return null;

  const config = readQuizConfig(quizJson);
  const quiz = quizJson as QuizJson;
  const deadline = attemptDeadline(attempt.startedAt, config);
  const timedOut =
    deadline != null && Date.now() > deadline.getTime() + QUIZ_GRACE_SEC * 1000;

  const results: Record<string, boolean> = {};
  const correct: Record<string, string> = {};
  let score = 0;

  for (const question of quiz.questions) {
    const correctOption = question.options.find((o) => o.correct);
    if (correctOption) correct[question.id] = correctOption.id;
    // Un intento que venció se califica igual, con lo que haya respondido: así
    // el alumno ve en qué iba, y el intento queda gastado de todas formas.
    const isCorrect =
      !timedOut &&
      Boolean(answers[question.id]) &&
      answers[question.id] === correctOption?.id;
    results[question.id] = isCorrect;
    if (isCorrect) score += 1;
  }

  const total = quiz.questions.length;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = !timedOut && percent >= config.passPercent;

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { submittedAt: new Date(), answers, score, total, passed },
  });

  return { score, total, passed, percent, results, correct, timedOut };
};
