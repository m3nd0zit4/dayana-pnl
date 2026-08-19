"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { BookOpen, Check, Lock, Play } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/components/ui/accordion";
import { Badge } from "@/app/components/ui/badge";
import LocalInstantText from "@/app/components/datetime/LocalInstantText";
import type { OutlineClass, OutlineModule } from "./CoursePlayer";

/** Sentinel id for a module's own overview/reading content, distinct from a class id. */
export const readingId = (moduleId: string) => `reading:${moduleId}`;

/**
 * Quita el «Módulo 3 · » del título: el número ya lo pinta la fila de arriba,
 * y repetirlo en una columna de 17rem se comía el título real hasta dejarlo en
 * puntos suspensivos.
 */
const stripModulePrefix = (title: string) =>
  title.replace(/^m[óo]dulo\s*\d+\s*[·\-–—.:]\s*/i, "");

type Props = {
  modules: OutlineModule[];
  completedClassIds: Set<string>;
  completedModuleIds: Set<string>;
  selectedId: string | null;
  isCurrent: boolean;
  onSelect: (id: string) => void;
};

const classSubtitle = (cls: OutlineClass): ReactNode => {
  if (cls.contentType === "TEXT") return "Lectura";
  if (cls.contentType === "PDF") return "PDF";
  if (cls.contentType === "EXERCISE") {
    const n = cls.exercise?.sections.reduce((sum, s) => sum + s.fields.length, 0) ?? 0;
    return n === 1 ? "Ejercicio · 1 pregunta" : `Ejercicio · ${n} preguntas`;
  }
  if (cls.contentType === "QUIZ") {
    const n = cls.quiz?.questions.length ?? 0;
    return n === 1 ? "Cuestionario · 1 pregunta" : `Cuestionario · ${n} preguntas`;
  }
  if (cls.recordingUrl || cls.muxPlaybackId) {
    if (cls.recordingDurationSec) {
      const min = Math.max(1, Math.round(cls.recordingDurationSec / 60));
      return `Video · ${min} min`;
    }
    return "Video";
  }
  if (cls.scheduledAt) {
    return (
      <>
        En vivo ·{" "}
        <LocalInstantText startsAtIso={cls.scheduledAt} mode="datetime" placeholder="…" />
      </>
    );
  }
  // Una lección de la biblioteca sin grabación está pendiente de subir, no
  // «por programar» — eso último solo tiene sentido en una clase en vivo.
  return cls.evergreen ? "Video · próximamente" : "Por programar";
};

const StatusDot = ({
  state,
}: {
  state: "locked" | "done" | "current" | "todo";
}) => (
  <span
    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
      state === "done"
        ? "border-primary bg-primary text-primary-foreground"
        : state === "current"
          ? "border-primary text-primary"
          : state === "locked"
            ? "border-sidebar-border bg-sidebar-accent/60 text-muted-foreground"
            : "border-sidebar-border text-muted-foreground"
    }`}
  >
    {state === "locked" ? (
      <Lock className="size-3" aria-hidden />
    ) : state === "done" ? (
      <Check className="size-3.5" aria-hidden />
    ) : state === "current" ? (
      <Play className="size-3 fill-current" aria-hidden />
    ) : (
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
    )}
  </span>
);

const OutlineRow = ({
  icon,
  title,
  subtitle,
  selected,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        selected ? "bg-primary/10 text-primary" : "hover:bg-sidebar-accent/70"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        {/* Dos líneas antes de recortar: en 17rem, `truncate` dejaba casi todos
            los títulos en puntos suspensivos. */}
        <span className="block leading-snug font-medium text-pretty">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  </li>
);

const CourseOutlineSidebar = ({
  modules,
  completedClassIds,
  completedModuleIds,
  selectedId,
  isCurrent,
  onSelect,
}: Props) => {
  const selectedModuleId = modules.find(
    (m) => m.classes.some((c) => c.id === selectedId) || readingId(m.id) === selectedId
  )?.id;

  // Acordeón controlado. Con `defaultValue` calculado a partir de la selección,
  // Base UI avisa de que el valor por defecto cambia después de inicializarse —
  // y al saltar a una lección de otro módulo, ese módulo no se abría.
  const [openModules, setOpenModules] = useState<string[]>(() =>
    selectedModuleId ? [selectedModuleId] : modules[0] ? [modules[0].id] : []
  );

  useEffect(() => {
    if (!selectedModuleId) return;
    setOpenModules((prev) =>
      prev.includes(selectedModuleId) ? prev : [...prev, selectedModuleId]
    );
  }, [selectedModuleId]);

  if (modules.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Badge variant="secondary">Próximamente</Badge>
        El contenido del curso se publicará aquí pronto.
      </div>
    );
  }

  return (
    <Accordion
      multiple
      value={openModules}
      onValueChange={(value) => setOpenModules(value as string[])}
      className="divide-y divide-sidebar-border"
    >
      {modules.map((mod, index) => {
        const hasReading = !!mod.bodyMd?.trim();
        const total = mod.classes.length;
        const done = mod.classes.filter((c) => completedClassIds.has(c.id)).length;
        const moduleDone = (hasReading ? completedModuleIds.has(mod.id) : true) && done === total;
        return (
          <AccordionItem key={mod.id} value={mod.id} className="px-1">
            <AccordionTrigger className="px-3 hover:no-underline">
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  Módulo {index + 1}
                </p>
                <div className="mt-0.5 flex min-w-0 items-start gap-1.5">
                  {moduleDone && (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                  )}
                  <span className="block min-w-0 leading-snug font-semibold text-balance">
                    {stripModulePrefix(mod.title)}
                  </span>
                </div>
                {total > 0 && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {done}/{total} completadas
                  </div>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-1 pb-1">
              <ul className="space-y-0.5">
                {hasReading && (
                  <OutlineRow
                    icon={
                      <StatusDot
                        state={
                          !isCurrent
                            ? "locked"
                            : completedModuleIds.has(mod.id)
                              ? "done"
                              : selectedId === readingId(mod.id)
                                ? "current"
                                : "todo"
                        }
                      />
                    }
                    title="Introducción"
                    subtitle="Lectura"
                    selected={selectedId === readingId(mod.id)}
                    onSelect={() => onSelect(readingId(mod.id))}
                  />
                )}
                {mod.classes.map((cls) => {
                  const completed = completedClassIds.has(cls.id);
                  const selected = cls.id === selectedId;
                  const locked = !isCurrent;
                  return (
                    <OutlineRow
                      key={cls.id}
                      icon={
                        <StatusDot
                          state={
                            locked ? "locked" : completed ? "done" : selected ? "current" : "todo"
                          }
                        />
                      }
                      title={cls.title}
                      subtitle={classSubtitle(cls)}
                      selected={selected}
                      onSelect={() => onSelect(cls.id)}
                    />
                  );
                })}
                {total === 0 && !hasReading && (
                  <li className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                    <BookOpen className="size-3.5" aria-hidden />
                    Sin clases todavía
                  </li>
                )}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
};

export default CourseOutlineSidebar;
