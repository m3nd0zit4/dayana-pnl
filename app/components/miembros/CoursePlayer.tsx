"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, ChevronRight, Download, LogOut, User } from "lucide-react";
import type { LessonContentType } from "@prisma/client";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/app/components/ui/sidebar";
import MemberNotificationBell from "./MemberNotificationBell";
import DriveRecordingEmbed from "./DriveRecordingEmbed";
import MuxRecordingEmbed from "./MuxRecordingEmbed";
import ClassCompleteToggle from "./ClassCompleteToggle";
import ModuleCompleteToggle from "./ModuleCompleteToggle";
import LessonComments from "./LessonComments";
import QuizPlayer, { type SanitizedQuiz } from "./QuizPlayer";
import CourseOutlineSidebar, { readingId } from "./CourseOutlineSidebar";

export type OutlineClass = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  meetUrl: string | null;
  recordingUrl: string | null;
  muxPlaybackId: string | null;
  recordingDurationSec: number | null;
  recordingPostedAt: string | null;
  recordingHiddenAt: string | null;
  contentType: LessonContentType;
  bodyMd: string | null;
  materialFileName: string | null;
  materialSizeBytes: number | null;
  quiz: SanitizedQuiz | null;
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
  percent: number;
  isCurrent: boolean;
  neverPaid: boolean;
  viewerContactId: string;
};

const RECORDING_RETENTION_DAYS = 30;

/** Client-safe mirror of lib/lms/course-content.ts's isRecordingVisible —
 *  that file imports the Prisma client at module scope, so it can't be
 *  imported here directly without pulling a server-only dependency into the
 *  browser bundle. */
const isRecordingVisible = (cls: OutlineClass, now = Date.now()): boolean => {
  if ((!cls.recordingUrl && !cls.muxPlaybackId) || cls.recordingHiddenAt || !cls.recordingPostedAt)
    return false;
  const visibleUntil =
    new Date(cls.recordingPostedAt).getTime() +
    RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return visibleUntil > now;
};

const formatDateTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString("es-CO", { dateStyle: "full" })} · ${new Date(
    iso
  ).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

type FlatItem = {
  id: string;
  title: string;
  moduleTitle: string;
  moduleIndex: number;
};

const CoursePlayer = ({
  productId,
  courseTitle,
  modules,
  completedClassIds: initialCompletedClasses,
  completedModuleIds: initialCompletedModules,
  selectedClassId: initialSelected,
  percent,
  isCurrent,
  neverPaid,
  viewerContactId,
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
  const livePercent =
    allClasses.length > 0
      ? Math.round((completedClassIds.size / allClasses.length) * 100)
      : percent;
  const selectedClass = allClasses.find((c) => c.id === selectedId) ?? null;
  const selectedReadingModule = selectedClass
    ? null
    : modules.find((m) => readingId(m.id) === selectedId) ?? null;

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    modules.forEach((m, index) => {
      if (m.bodyMd?.trim()) {
        items.push({ id: readingId(m.id), title: "Introducción", moduleTitle: m.title, moduleIndex: index });
      }
      m.classes.forEach((c) => {
        items.push({ id: c.id, title: c.title, moduleTitle: m.title, moduleIndex: index });
      });
    });
    return items;
  }, [modules]);

  const selectedIndex = flatItems.findIndex((it) => it.id === selectedId);
  const prevItem = selectedIndex > 0 ? flatItems[selectedIndex - 1] : null;
  const nextItem =
    selectedIndex >= 0 && selectedIndex < flatItems.length - 1
      ? flatItems[selectedIndex + 1]
      : null;
  const currentBreadcrumb =
    selectedIndex >= 0 ? flatItems[selectedIndex] : null;

  const selectItem = (id: string) => {
    setSelectedId(id);
    router.replace(`/miembros/curso/${productId}?c=${id}`, { scroll: false });
  };

  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
        <SidebarHeader className="px-3 py-5">
          <p className="text-sm leading-none tracking-[0.14em] uppercase">Dayana Beltrán</p>
          <p className="mt-1 text-[9px] tracking-[0.45em] text-muted-foreground uppercase">
            Portal del curso
          </p>
          <p className="mt-3 truncate text-xs font-semibold text-sidebar-foreground">
            {courseTitle}
          </p>
        </SidebarHeader>
        <SidebarContent className="px-2 py-2">
          {isCurrent && allClasses.length > 0 && (
            <Card size="sm" className="mx-1 mb-3">
              <CardContent className="space-y-2 px-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-sidebar-foreground">Tu progreso</span>
                  <span className="text-muted-foreground">{livePercent}%</span>
                </div>
                <Progress value={livePercent} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  {completedClassIds.size} de {allClasses.length} clases completadas
                </p>
              </CardContent>
            </Card>
          )}
          <CourseOutlineSidebar
            modules={modules}
            completedClassIds={completedClassIds}
            completedModuleIds={completedModuleIds}
            selectedId={selectedId}
            isCurrent={isCurrent}
            onSelect={selectItem}
          />
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="bg-transparent">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="lg:hidden" />
            <div className="min-w-0">
              <Link
                href="/miembros"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Mi aprendizaje
              </Link>
              <h1 className="truncate text-sm font-semibold tracking-tight">{courseTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isCurrent && (
              <div className="hidden w-40 shrink-0 sm:block">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Progreso</span>
                  <span className="font-medium text-foreground">{livePercent}%</span>
                </div>
                <Progress value={livePercent} />
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {/* Esta cabecera es la del reproductor, hermana de la del shell:
                  PortalSidebar hace early-return aquí y no pinta la suya, así
                  que la campana tiene que repetirse en este lado. */}
              <MemberNotificationBell className="-my-1" />
              <Link
                href="/miembros/cuenta"
                aria-label="Mi cuenta"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <User className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Mi cuenta</span>
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/acceso" })}
                aria-label="Salir"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <LogOut className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 lg:px-8">
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
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Módulo {currentBreadcrumb ? currentBreadcrumb.moduleIndex + 1 : ""} · Lectura
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  {selectedReadingModule.title}
                </h2>
              </div>
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
          ) : selectedClass.contentType !== "VIDEO" ? (
            <div className="space-y-4">
              <Card>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                        Módulo {currentBreadcrumb ? currentBreadcrumb.moduleIndex + 1 : ""} ·{" "}
                        {selectedClass.contentType === "TEXT"
                          ? "Lectura"
                          : selectedClass.contentType === "PDF"
                            ? "Material"
                            : "Cuestionario"}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-tight">
                        {selectedClass.title}
                      </h2>
                      {selectedClass.description && (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {selectedClass.description}
                        </p>
                      )}
                    </div>
                    {selectedClass.contentType !== "QUIZ" && (
                      <ClassCompleteToggle
                        key={selectedClass.id}
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
                    )}
                  </div>

                  {selectedClass.contentType === "TEXT" && (
                    <div className="text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc">
                      <Markdown remarkPlugins={[remarkGfm]}>
                        {selectedClass.bodyMd || "*Sin contenido*"}
                      </Markdown>
                    </div>
                  )}

                  {selectedClass.contentType === "PDF" &&
                    (selectedClass.materialFileName ? (
                      <Button
                        variant="outline"
                        nativeButton={false}
                        render={<a href={`/api/miembros/classes/${selectedClass.id}/material`} />}
                      >
                        <Download />
                        Descargar {selectedClass.materialFileName}
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        El material aún no está disponible.
                      </p>
                    ))}

                  {selectedClass.contentType === "QUIZ" &&
                    (selectedClass.quiz && selectedClass.quiz.questions.length > 0 ? (
                      <QuizPlayer
                        key={selectedClass.id}
                        classId={selectedClass.id}
                        quiz={selectedClass.quiz}
                        alreadyCompleted={completedClassIds.has(selectedClass.id)}
                        onSubmitted={() =>
                          setCompletedClassIds((prev) => new Set(prev).add(selectedClass.id))
                        }
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Este cuestionario aún no tiene preguntas.
                      </p>
                    ))}

                  <div className="border-t border-border pt-6">
                    <LessonComments
                      key={selectedClass.id}
                      classId={selectedClass.id}
                      viewerContactId={viewerContactId}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-4">
              {!isRecordingVisible(selectedClass) && (
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                    Módulo {currentBreadcrumb ? currentBreadcrumb.moduleIndex + 1 : ""} · Clase
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight">{selectedClass.title}</h2>
                  {selectedClass.description && (
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {selectedClass.description}
                    </p>
                  )}
                </div>
              )}

              {isRecordingVisible(selectedClass) ? (
                <Card className="overflow-hidden py-0">
                  {selectedClass.muxPlaybackId ? (
                    <MuxRecordingEmbed
                      key={selectedClass.id}
                      classId={selectedClass.id}
                      title={selectedClass.title}
                    />
                  ) : (
                    <DriveRecordingEmbed
                      url={selectedClass.recordingUrl!}
                      title={selectedClass.title}
                    />
                  )}
                  <CardContent className="space-y-6 pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                          Módulo {currentBreadcrumb ? currentBreadcrumb.moduleIndex + 1 : ""} · Clase
                        </p>
                        <h2 className="mt-1 text-xl font-semibold tracking-tight">
                          {selectedClass.title}
                        </h2>
                        {selectedClass.description && (
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {selectedClass.description}
                          </p>
                        )}
                      </div>
                      <ClassCompleteToggle
                        key={selectedClass.id}
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
                    </div>
                    <div className="border-t border-border pt-6">
                      <LessonComments
                        key={selectedClass.id}
                        classId={selectedClass.id}
                        viewerContactId={viewerContactId}
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : selectedClass.recordingUrl || selectedClass.muxPlaybackId ? (
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

              {!isRecordingVisible(selectedClass) && (
                <div className="border-t border-border pt-6">
                  <LessonComments
                    key={selectedClass.id}
                    classId={selectedClass.id}
                    viewerContactId={viewerContactId}
                  />
                </div>
              )}
            </div>
          )}

          {isCurrent && (prevItem || nextItem) && (
            <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
              {prevItem ? (
                <Button variant="outline" onClick={() => selectItem(prevItem.id)}>
                  <ChevronLeft />
                  <span className="max-w-40 truncate sm:max-w-56">{prevItem.title}</span>
                </Button>
              ) : (
                <span />
              )}
              {nextItem ? (
                <Button onClick={() => selectItem(nextItem.id)}>
                  <span className="max-w-40 truncate sm:max-w-56">{nextItem.title}</span>
                  <ChevronRight />
                </Button>
              ) : (
                <span />
              )}
            </div>
          )}
        </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default CoursePlayer;
