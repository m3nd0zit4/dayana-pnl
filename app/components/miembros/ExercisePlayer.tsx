"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDashed, Loader2 } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Progress } from "@/app/components/ui/progress";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import LessonProse from "./LessonProse";

export type ExerciseFieldData = {
  id: string;
  label: string;
  help?: string;
  type?: "long" | "short" | "choice";
  options?: string[];
  placeholder?: string;
  required?: boolean;
};

export type ExerciseData = {
  introMd?: string;
  sections: Array<{ title?: string; bodyMd?: string; fields: ExerciseFieldData[] }>;
  closingMd?: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

/** Espera antes de guardar: suficiente para no disparar en cada tecla, corto
 *  para que nadie llegue a cambiar de lección con algo sin guardar. */
const SAVE_DEBOUNCE_MS = 900;

const ExercisePlayer = ({
  classId,
  exercise,
  onCompletedChange,
}: {
  classId: string;
  exercise: ExerciseData;
  onCompletedChange: (completed: boolean) => void;
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, string> | null>(null);

  const fields = useMemo(
    () => exercise.sections.flatMap((s) => s.fields),
    [exercise]
  );
  const required = useMemo(
    () => fields.filter((f) => f.required !== false),
    [fields]
  );
  const answeredRequired = required.filter(
    (f) => (answers[f.id] ?? "").trim().length > 0
  ).length;
  const percent =
    required.length > 0 ? Math.round((answeredRequired / required.length) * 100) : 0;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/miembros/classes/${classId}/exercise`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { answers?: Record<string, string> } | null) => {
        if (!cancelled && data?.answers) setAnswers(data.answers);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const flush = useCallback(
    async (next: Record<string, string>) => {
      setSaveState("saving");
      const res = await fetch(`/api/miembros/classes/${classId}/exercise`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: next }),
      });
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      const data = (await res.json()) as { complete?: boolean };
      setSaveState("saved");
      onCompletedChange(Boolean(data.complete));
    },
    [classId, onCompletedChange]
  );

  const update = (fieldId: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [fieldId]: value };
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current) void flush(pending.current);
      }, SAVE_DEBOUNCE_MS);
      return next;
    });
  };

  // Salir de la lección (o cerrar la pestaña) no debe perder lo último escrito.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void flush(pending.current);
    },
    [flush]
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando tus respuestas…</p>;
  }

  return (
    <div className="space-y-8">
      {exercise.introMd && <LessonProse>{exercise.introMd}</LessonProse>}

      <div className="sticky top-16 z-10 -mx-1 flex items-center gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 backdrop-blur">
        <Progress value={percent} className="h-1.5 flex-1" />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {answeredRequired}/{required.length}
        </span>
        <span className="flex w-24 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground">
          {saveState === "saving" ? (
            <>
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Guardando
            </>
          ) : saveState === "saved" ? (
            <>
              <Check className="size-3 text-success" aria-hidden />
              Guardado
            </>
          ) : saveState === "error" ? (
            <span className="text-destructive">Sin guardar</span>
          ) : (
            <>
              <CircleDashed className="size-3" aria-hidden />
              Autoguardado
            </>
          )}
        </span>
      </div>

      {exercise.sections.map((section, sIndex) => (
        <section key={sIndex} className="space-y-5">
          {section.title && (
            <h3 className="text-base font-semibold tracking-tight">{section.title}</h3>
          )}
          {section.bodyMd && <LessonProse>{section.bodyMd}</LessonProse>}

          {section.fields.map((field) => {
            const value = answers[field.id] ?? "";
            const filled = value.trim().length > 0;
            return (
              <div key={field.id} className="space-y-2">
                <Label
                  htmlFor={`ex-${field.id}`}
                  className="flex items-start gap-2 text-sm leading-snug font-medium"
                >
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      filled ? "bg-success" : "bg-muted-foreground/40"
                    )}
                    aria-hidden
                  />
                  <span>
                    {field.label}
                    {field.required === false && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (opcional)
                      </span>
                    )}
                  </span>
                </Label>
                {field.help && (
                  <p className="pl-3.5 text-xs text-muted-foreground">{field.help}</p>
                )}

                {field.type === "choice" && field.options ? (
                  <div className="space-y-1.5 pl-3.5">
                    {field.options.map((option) => (
                      <label
                        key={option}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                          value === option
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        <input
                          type="radio"
                          name={`ex-${field.id}`}
                          checked={value === option}
                          onChange={() => update(field.id, option)}
                          className="size-4 accent-primary"
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                ) : field.type === "short" ? (
                  <Input
                    id={`ex-${field.id}`}
                    value={value}
                    placeholder={field.placeholder}
                    onChange={(e) => update(field.id, e.target.value)}
                    className="ml-3.5 w-[calc(100%-0.875rem)]"
                  />
                ) : (
                  <Textarea
                    id={`ex-${field.id}`}
                    value={value}
                    placeholder={field.placeholder ?? "Escribe aquí…"}
                    onChange={(e) => update(field.id, e.target.value)}
                    className="ml-3.5 min-h-24 w-[calc(100%-0.875rem)]"
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}

      {exercise.closingMd && (
        <div className="border-t border-border pt-6">
          <LessonProse>{exercise.closingMd}</LessonProse>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Tus respuestas se guardan solas y quedan aquí para cuando quieras
        volver. El ejercicio se marca como completado al responder todo.
      </p>
    </div>
  );
};

export default ExercisePlayer;
