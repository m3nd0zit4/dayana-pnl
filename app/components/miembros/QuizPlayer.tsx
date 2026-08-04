"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

export type SanitizedQuiz = {
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; text: string }>;
  }>;
};

type QuizPlayerProps = {
  classId: string;
  quiz: SanitizedQuiz;
  alreadyCompleted: boolean;
  onSubmitted: () => void;
};

type Result = { score: number; total: number; results: Record<string, boolean> };

const QuizPlayer = ({ classId, quiz, alreadyCompleted, onSubmitted }: QuizPlayerProps) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [done, setDone] = useState(alreadyCompleted);

  const allAnswered = quiz.questions.every((q) => answers[q.id]);

  const submit = async () => {
    setSubmitting(true);
    const res = await fetch(`/api/miembros/classes/${classId}/quiz`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setSubmitting(false);
    if (!res.ok) return;
    const data = (await res.json()) as Result;
    setResult(data);
    setDone(true);
    onSubmitted();
  };

  return (
    <div className="space-y-5">
      {quiz.questions.map((q, qIndex) => (
        <div key={q.id} className="space-y-2">
          <p className="text-sm font-medium">
            {qIndex + 1}. {q.prompt}
          </p>
          <div className="space-y-1.5">
            {q.options.map((opt) => {
              const selected = answers[q.id] === opt.id;
              const graded = result?.results[q.id];
              return (
                <label
                  key={opt.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    result && "pointer-events-none"
                  )}
                >
                  <input
                    type="radio"
                    name={q.id}
                    checked={selected}
                    disabled={Boolean(result)}
                    onChange={() => setAnswers((s) => ({ ...s, [q.id]: opt.id }))}
                    className="size-4 accent-primary"
                  />
                  <span className="flex-1">{opt.text}</span>
                  {result && selected && graded === true && (
                    <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                  )}
                  {result && selected && graded === false && (
                    <XCircle className="size-4 text-destructive" aria-hidden />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {result ? (
        <p className="text-sm font-medium">
          Resultado: {result.score} de {result.total} correctas.
        </p>
      ) : done ? (
        <p className="text-sm text-muted-foreground">Ya respondiste este cuestionario.</p>
      ) : (
        <Button disabled={!allAnswered || submitting} onClick={() => void submit()}>
          {submitting ? "Enviando…" : "Enviar respuestas"}
        </Button>
      )}
    </div>
  );
};

export default QuizPlayer;
