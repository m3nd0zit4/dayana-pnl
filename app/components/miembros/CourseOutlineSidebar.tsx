"use client";

import { BookOpen, Check, Lock, PlayCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/components/ui/accordion";
import { Badge } from "@/app/components/ui/badge";
import type { OutlineClass, OutlineModule } from "./CoursePlayer";

/** Sentinel id for a module's own overview/reading content, distinct from a class id. */
export const readingId = (moduleId: string) => `reading:${moduleId}`;

type Props = {
  modules: OutlineModule[];
  completedClassIds: Set<string>;
  completedModuleIds: Set<string>;
  selectedId: string | null;
  isCurrent: boolean;
  onSelect: (id: string) => void;
};

const classSubtitle = (cls: OutlineClass): string => {
  if (cls.recordingUrl) return "Video";
  if (cls.scheduledAt) {
    return `En vivo · ${new Date(cls.scheduledAt).toLocaleDateString("es-CO", {
      day: "numeric",
      month: "short",
    })}`;
  }
  return "Por programar";
};

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

  return (
    <Accordion
      multiple
      defaultValue={selectedModuleId ? [selectedModuleId] : modules[0] ? [modules[0].id] : []}
      className="divide-y divide-border"
    >
      {modules.map((mod) => {
        const hasReading = !!mod.bodyMd?.trim();
        const total = mod.classes.length;
        const done = mod.classes.filter((c) => completedClassIds.has(c.id)).length;
        return (
          <AccordionItem key={mod.id} value={mod.id} className="px-1">
            <AccordionTrigger className="px-3">
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate font-semibold">{mod.title}</div>
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
                  <li>
                    <button
                      type="button"
                      onClick={() => onSelect(readingId(mod.id))}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        selectedId === readingId(mod.id) ? "bg-secondary" : "hover:bg-secondary/50"
                      }`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {!isCurrent ? (
                          <Lock className="size-4 text-muted-foreground" aria-hidden />
                        ) : completedModuleIds.has(mod.id) ? (
                          <Check className="size-4 text-emerald-600" aria-hidden />
                        ) : (
                          <BookOpen className="size-4 text-muted-foreground" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">Introducción</span>
                        <span className="block text-xs text-muted-foreground">Lectura</span>
                      </span>
                    </button>
                  </li>
                )}
                {mod.classes.map((cls) => {
                  const completed = completedClassIds.has(cls.id);
                  const selected = cls.id === selectedId;
                  const locked = !isCurrent;
                  return (
                    <li key={cls.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(cls.id)}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          selected ? "bg-secondary" : "hover:bg-secondary/50"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          {locked ? (
                            <Lock className="size-4 text-muted-foreground" aria-hidden />
                          ) : completed ? (
                            <Check className="size-4 text-emerald-600" aria-hidden />
                          ) : (
                            <PlayCircle className="size-4 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{cls.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {classSubtitle(cls)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {total === 0 && !hasReading && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    Sin clases todavía
                  </li>
                )}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
      {modules.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
          <Badge variant="secondary">Próximamente</Badge>
          El contenido del curso se publicará aquí pronto.
        </div>
      )}
    </Accordion>
  );
};

export default CourseOutlineSidebar;
