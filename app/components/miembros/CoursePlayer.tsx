"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import DriveRecordingEmbed from "./DriveRecordingEmbed";
import ClassCompleteToggle from "./ClassCompleteToggle";
import ModuleCompleteToggle from "./ModuleCompleteToggle";
import CourseOutlineSidebar, { readingId } from "./CourseOutlineSidebar";

export type OutlineClass = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  meetUrl: string | null;
  recordingUrl: string | null;
  recordingPostedAt: string | null;
  recordingHiddenAt: string | null;
};

export type OutlineModule = {
  id: string;
  title: string;
  bodyMd: string | null;
  classes: OutlineClass[];
};

type Props = {
  productId: string;
  courseTitle: string;
  modules: OutlineModule[];
  completedClassIds: string[];
  completedModuleIds: string[];
  selectedClassId: string | null;
  isCurrent: boolean;
  neverPaid: boolean;
};

const RECORDING_RETENTION_DAYS = 30;

/** Client-safe mirror of lib/lms/course-content.ts's isRecordingVisible —
 *  that file imports the Prisma client at module scope, so it can't be
 *  imported here directly without pulling a server-only dependency into the
 *  browser bundle. */
const isRecordingVisible = (cls: OutlineClass, now = Date.now()): boolean => {
  if (!cls.recordingUrl || cls.recordingHiddenAt || !cls.recordingPostedAt) return false;
  const visibleUntil =
    new Date(cls.recordingPostedAt).getTime() +
    RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return visibleUntil > now;
};

const formatDateTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString("es-CO", { dateStyle: "full" })} · ${new Date(
    iso
  ).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

const CoursePlayer = ({
  productId,
  courseTitle,
  modules,
  completedClassIds: initialCompletedClasses,
  completedModuleIds: initialCompletedModules,
  selectedClassId: initialSelected,
  isCurrent,
  neverPaid,
}: Props) => {
  const router = useRouter();
  const [completedClassIds, setCompletedClassIds] = useState(
    () => new Set(initialCompletedClasses)
  );
  const [completedModuleIds, setCompletedModuleIds] = useState(
    () => new Set(initialCompletedModules)
  );
  const [selectedId, setSelectedId] = useState(initialSelected);

  const allClasses = useMemo(() => modules.flatMap((m) => m.classes), [modules]);
  const selectedClass = allClasses.find((c) => c.id === selectedId) ?? null;
  const selectedReadingModule = selectedClass
    ? null
    : modules.find((m) => readingId(m.id) === selectedId) ?? null;

  const selectItem = (id: string) => {
    setSelectedId(id);
    router.replace(`/miembros/curso/${productId}?c=${id}`, { scroll: false });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="rounded-xl border border-border bg-card lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold">{courseTitle}</h1>
        </div>
        <CourseOutlineSidebar
          modules={modules}
          completedClassIds={completedClassIds}
          completedModuleIds={completedModuleIds}
          selectedId={selectedId}
          isCurrent={isCurrent}
          onSelect={selectItem}
        />
      </div>

      <div className="min-w-0">
        {!isCurrent ? (
          <Card className="border-primary/30">
            <CardContent className="py-10 text-center">
              <p className="text-[11px] tracking-[0.3em] text-muted-foreground uppercase">
                Portal del curso
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                {neverPaid ? "Activa tu membresía para continuar" : "Renueva para seguir viendo el curso"}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                {neverPaid
                  ? "Tu cuenta está lista — activa tu mensualidad para ver las clases en vivo, grabaciones y el contenido de cada módulo."
                  : "Tu mensualidad venció. Renueva para recuperar el acceso a las clases y grabaciones."}
              </p>
              <Button
                className="mt-6"
                nativeButton={false}
                render={<Link href="/servicios#curso" />}
              >
                {neverPaid ? "Activar acceso" : "Renovar ahora"}
              </Button>
            </CardContent>
          </Card>
        ) : selectedReadingModule ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight">
              {selectedReadingModule.title}
            </h2>
            <Card>
              <CardContent className="text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {selectedReadingModule.bodyMd || ""}
                </Markdown>
              </CardContent>
            </Card>
            <ModuleCompleteToggle
              moduleId={selectedReadingModule.id}
              initialCompleted={completedModuleIds.has(selectedReadingModule.id)}
              onChange={(completed) =>
                setCompletedModuleIds((prev) => {
                  const next = new Set(prev);
                  if (completed) next.add(selectedReadingModule.id);
                  else next.delete(selectedReadingModule.id);
                  return next;
                })
              }
            />
          </div>
        ) : !selectedClass ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              El contenido de este curso se publicará aquí pronto.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{selectedClass.title}</h2>
              {selectedClass.description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {selectedClass.description}
                </p>
              )}
            </div>

            {isRecordingVisible(selectedClass) ? (
              <>
                <DriveRecordingEmbed
                  url={selectedClass.recordingUrl!}
                  title={selectedClass.title}
                />
                <ClassCompleteToggle
                  classId={selectedClass.id}
                  initialCompleted={completedClassIds.has(selectedClass.id)}
                  onChange={(completed) =>
                    setCompletedClassIds((prev) => {
                      const next = new Set(prev);
                      if (completed) next.add(selectedClass.id);
                      else next.delete(selectedClass.id);
                      return next;
                    })
                  }
                />
              </>
            ) : selectedClass.recordingUrl ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  La grabación de esta clase venció (disponible por{" "}
                  {RECORDING_RETENTION_DAYS} días desde su publicación).
                </CardContent>
              </Card>
            ) : selectedClass.scheduledAt ? (
              <Card>
                <CardContent className="space-y-3 py-6">
                  <p className="text-sm font-medium">
                    Próxima sesión en vivo: {formatDateTime(selectedClass.scheduledAt)}
                  </p>
                  {selectedClass.meetUrl && (
                    <Button
                      nativeButton={false}
                      render={
                        <a href={selectedClass.meetUrl} target="_blank" rel="noopener noreferrer" />
                      }
                    >
                      Unirme por Google Meet
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    La grabación aparecerá aquí mismo después de la clase.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  Esta clase aún no tiene fecha. Te avisaremos por correo y WhatsApp.
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CoursePlayer;
