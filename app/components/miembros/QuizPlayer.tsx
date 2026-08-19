"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  ListChecks,
  RotateCcw,
  Target,
  XCircle,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Progress } from "@/app/components/ui/progress";
import { cn } from "@/lib/utils";

export type SanitizedQuiz = {
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; text: string }>;
  }>;
};

type QuizConfig = {
  timeLimitMin: number;
  maxAttempts: number;
  passPercent: number;
};

type QuizState = {
  config: QuizConfig;
  questionCount: number;
  attemptsUsed: number;
  attemptsLeft: number | null;
  bestScore: number | null;
  passed: boolean;
  openAttempt: { id: string; endsAt: string | null } | null;
};

type GradeResult = {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  timedOut: boolean;
  results: Record<string, boolean>;
  correct: Record<string, string>;
  state: QuizState;
};

type Props = {
  classId: string;
  quiz: SanitizedQuiz;
  alreadyCompleted: boolean;
  onSubmitted: () => void;
};

const formatClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const Stat = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Target;
  label: string;
  value: string;
}) => (
  <div className="flex items-start gap-2.5">
    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  </div>
);

const QuizPlayer = ({ classId, quiz, alreadyCompleted, onSubmitted }: Props) => {
  const [state, setState] = useState<QuizState | null>(null);
  const [loading, setLoading] = useState(true);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // El envío automático al vencer el tiempo tiene que verse una sola vez: el
  // tick del reloj corre cada segundo y dispararía el POST en cada uno.
  const autoSubmitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/miembros/classes/${classId}/quiz`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: QuizState | null) => {
        if (cancelled || !data) return;
        setState(data);
        if (data.openAttempt) {
          setAttemptId(data.openAttempt.id);
          setEndsAt(data.openAttempt.endsAt);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const running = attemptId != null && result == null;

  useEffect(() => {
    if (!running || !endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, endsAt]);

  const msLeft = endsAt ? new Date(endsAt).getTime() - now : null;

  const submit = useCallback(async () => {
    if (!attemptId) return;
    setSubmitting(true);
    const res = await fetch(`/api/miembros/classes/${classId}/quiz`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId, answers }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError("No se pudo enviar el cuestionario. Intenta de nuevo.");
      return;
    }
    const data = (await res.json()) as GradeResult;
    setResult(data);
    setState(data.state);
    setAttemptId(null);
    setEndsAt(null);
    if (data.passed) onSubmitted();
  }, [attemptId, answers, classId, onSubmitted]);

  useEffect(() => {
    if (!running || msLeft == null || msLeft > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void submit();
  }, [running, msLeft, submit]);

  const start = async () => {
    setError(null);
    const res = await fetch(`/api/miembros/classes/${classId}/quiz/start`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        data?.error === "no_attempts_left"
          ? "Ya usaste todos los intentos disponibles."
          : data?.error === "already_passed"
            ? "Ya aprobaste este cuestionario."
            : "No se pudo iniciar el cuestionario."
      );
      return;
    }
    const data = (await res.json()) as {
      attemptId: string;
      endsAt: string | null;
      state: QuizState;
    };
    autoSubmitted.current = false;
    setAnswers({});
    setResult(null);
    setAttemptId(data.attemptId);
    setEndsAt(data.endsAt);
    setState(data.state);
    setNow(Date.now());
  };

  const answeredCount = useMemo(
    () => quiz.questions.filter((q) => answers[q.id]).length,
    [quiz.questions, answers]
  );
  const allAnswered = answeredCount === quiz.questions.length;

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Cargando el cuestionario…</p>
    );
  }

  const config = state?.config;
  const attemptsLabel =
    state?.attemptsLeft == null
      ? "Intentos ilimitados"
      : `${state.attemptsLeft} ${state.attemptsLeft === 1 ? "intento" : "intentos"} disponibles`;

  // ── Pantalla previa ──────────────────────────────────────────────────────
  if (!running && !result) {
    const noAttempts = state?.attemptsLeft != null && state.attemptsLeft <= 0;
    const passed = state?.passed || alreadyCompleted;

    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-muted/30 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              icon={ListChecks}
              label="Preguntas"
              value={`${quiz.questions.length}`}
            />
            <Stat
              icon={AlarmClock}
              label="Tiempo para responder"
              value={
                config && config.timeLimitMin > 0
                  ? `${config.timeLimitMin} min`
                  : "Sin límite"
              }
            />
            <Stat
              icon={Target}
              label="Para aprobar"
              value={`${config?.passPercent ?? 70}%`}
            />
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {passed
                ? "Ya aprobaste este cuestionario."
                : noAttempts
                  ? "No te quedan intentos."
                  : attemptsLabel}
              {state && state.attemptsUsed > 0 && state.bestScore != null && (
                <>
                  {" · "}Mejor resultado: {state.bestScore}/{quiz.questions.length}
                </>
              )}
            </p>
            {!passed && !noAttempts && config && config.timeLimitMin > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                El tiempo empieza a correr al pulsar «Empezar» y no se detiene si
                cierras la página. Al vencer, se envía lo que tengas respondido.
              </p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={() => void start()} disabled={noAttempts && !passed}>
          {passed ? "Repasar de nuevo" : state && state.attemptsUsed > 0 ? "Reintentar" : "Empezar cuestionario"}
        </Button>
      </div>
    );
  }

  // ── Resultado ────────────────────────────────────────────────────────────
  if (result) {
    const canRetry =
      !result.passed && (result.state.attemptsLeft == null || result.state.attemptsLeft > 0);

    return (
      <div className="space-y-6">
        <div
          className={cn(
            "rounded-xl border p-5",
            result.passed
              ? "border-success/40 bg-success/10"
              : "border-destructive/40 bg-destructive/10"
          )}
        >
          <p className="text-sm font-semibold">
            {result.timedOut
              ? "Se acabó el tiempo"
              : result.passed
                ? "¡Aprobado!"
                : "No alcanzaste la nota mínima"}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {result.score} / {result.total}
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {result.percent}%
            </span>
          </p>
          <Progress value={result.percent} className="mt-3 h-1.5" />
          <p className="mt-3 text-xs text-muted-foreground">
            Mínimo para aprobar: {result.state.config.passPercent}%
            {result.state.attemptsLeft != null &&
              ` · Te quedan ${result.state.attemptsLeft} ${result.state.attemptsLeft === 1 ? "intento" : "intentos"}`}
          </p>
        </div>

        <div className="space-y-5">
          {quiz.questions.map((q, i) => {
            const correctId = result.correct[q.id];
            const chosen = answers[q.id];
            return (
              <div key={q.id} className="space-y-2">
                <p className="text-sm font-medium">
                  {i + 1}. {q.prompt}
                </p>
                <div className="space-y-1.5">
                  {q.options.map((opt) => {
                    const isCorrect = opt.id === correctId;
                    const isChosen = opt.id === chosen;
                    return (
                      <div
                        key={opt.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                          isCorrect && "border-success/50 bg-success/10",
                          isChosen && !isCorrect && "border-destructive/50 bg-destructive/10",
                          !isCorrect && !isChosen && "border-border"
                        )}
                      >
                        <span className="flex-1">{opt.text}</span>
                        {isCorrect && (
                          <CheckCircle2 className="size-4 text-success" aria-hidden />
                        )}
                        {isChosen && !isCorrect && (
                          <XCircle className="size-4 text-destructive" aria-hidden />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {canRetry && (
          <Button variant="outline" onClick={() => void start()}>
            <RotateCcw />
            Intentar de nuevo
          </Button>
        )}
      </div>
    );
  }

  // ── Cuestionario en curso ────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="sticky top-16 z-10 -mx-1 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {answeredCount} de {quiz.questions.length} respondidas
        </p>
        {msLeft != null && (
          <p
            className={cn(
              "font-mono text-sm tabular-nums",
              msLeft < 60_000 ? "text-destructive" : "text-foreground"
            )}
          >
            {formatClock(msLeft)}
          </p>
        )}
      </div>

      {quiz.questions.map((q, qIndex) => (
        <div key={q.id} className="space-y-2">
          <p className="text-sm font-medium">
            {qIndex + 1}. {q.prompt}
          </p>
          <div className="space-y-1.5">
            {q.options.map((opt) => {
              const selected = answers[q.id] === opt.id;
              return (
                <label
                  key={opt.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  )}
                >
                  <input
                    type="radio"
                    name={q.id}
                    checked={selected}
                    onChange={() => setAnswers((s) => ({ ...s, [q.id]: opt.id }))}
                    className="size-4 accent-primary"
                  />
                  <span className="flex-1">{opt.text}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button disabled={!allAnswered || submitting} onClick={() => void submit()}>
          {submitting ? "Enviando…" : "Enviar respuestas"}
        </Button>
        {!allAnswered && (
          <p className="text-xs text-muted-foreground">
            Responde las {quiz.questions.length} preguntas para enviar.
          </p>
        )}
      </div>
    </div>
  );
};

export default QuizPlayer;
