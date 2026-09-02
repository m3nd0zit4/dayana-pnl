"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
} from "lucide-react";
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
import PortalUserMenu from "./PortalUserMenu";
import DriveRecordingEmbed from "./DriveRecordingEmbed";
import MuxRecordingEmbed from "./MuxRecordingEmbed";
import ClassCompleteToggle from "./ClassCompleteToggle";
import ModuleCompleteToggle from "./ModuleCompleteToggle";
import LessonComments from "./LessonComments";
import QuizPlayer, { type SanitizedQuiz } from "./QuizPlayer";
import ExercisePlayer, { type ExerciseData } from "./ExercisePlayer";
import CourseOutlineSidebar, { readingId } from "./CourseOutlineSidebar";
import LessonProse, { readingMinutes } from "./LessonProse";
import LocalInstantText from "@/app/components/datetime/LocalInstantText";

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
  evergreen: boolean;
  contentType: LessonContentType;
  bodyMd: string | null;
  materialFileName: string | null;
  materialSizeBytes: number | null;
  quiz: SanitizedQuiz | null;
  exercise: ExerciseData | null;
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
  /** Identidad de quien mira, para el avatar de la cabecera. */
  viewerName: string;
  viewerAvatarUrl: string | null;
  /** Sesión de staff puenteada al portal — ve una salida al CRM, no a la cuenta. */
  viewerIsOwner: boolean;
};

const RECORDING_RETENTION_DAYS = 30;

/** Client-safe mirror of lib/lms/course-content.ts's isRecordingVisible —
 *  that file imports the Prisma client at module scope, so it can't be
 *  imported here directly without pulling a server-only dependency into the
 *  browser bundle. */
const isRecordingVisible = (cls: OutlineClass, now = Date.now()): boolean => {
  if ((!cls.recordingUrl && !cls.muxPlaybackId) || cls.recordingHiddenAt) return false;
  if (cls.evergreen) return true;
  if (!cls.recordingPostedAt) return false;
  const visibleUntil =
    new Date(cls.recordingPostedAt).getTime() +
    RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return visibleUntil > now;
};

type FlatItem = {
  id: string;
  title: string;
  moduleTitle: string;
  moduleIndex: number;
};

/**
 * Cierre de la lección. El botón de la cabecera queda arriba del todo y, en una
 * lectura larga, para cuando terminas ya no está en pantalla — que es
 * justamente el momento en que querrías pulsarlo.
 */
const LessonFooterComplete = ({
  classId,
  completed,
  onChange,
}: {
  classId: string;
  completed: boolean;
  onChange: (completed: boolean) => void;
}) => (
  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
    <ClassCompleteToggle
      classId={classId}
      completed={completed}
      onChange={onChange}
      size="default"
    />
    <p className="text-xs text-muted-foreground">
      {completed
        ? "Ya la tienes marcada."
        : "También se marca sola cuando pasas aquí el tiempo suficiente."}
    </p>
  </div>
);

/**
 * Cabecera común de toda lección. Antes cada tipo de contenido repetía su
 * propio bloque de título dentro de la tarjeta, con el resultado de que el
 * texto empezaba pegado al borde y sin jerarquía. Sacarla de la tarjeta le da
 * al título el peso que le corresponde y deja el cuerpo limpio.
 */
const LessonHeader = ({
  moduleIndex,
  kind,
  title,
  description,
  meta,
  action,
}: {
  moduleIndex?: number;
  kind: string;
  title: string;
  description?: string | null;
  meta?: string;
  action?: ReactNode;
}) => (
  <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
    <div className="min-w-0">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {moduleIndex != null ? `Módulo ${moduleIndex + 1} · ` : ""}
        {kind}
        {meta ? ` · ${meta}` : ""}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
    {action}
  </header>
);

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
  viewerName,
  viewerAvatarUrl,
  viewerIsOwner,
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
  // `completedClassIds` llega con TODO lo que el contacto ha completado en la
  // biblioteca, no solo en este curso: contarlo entero hacía que terminar una
  // lección en un curso subiera el progreso de los demás.
  const completedHere = useMemo(
    () => allClasses.filter((c) => completedClassIds.has(c.id)).length,
    [allClasses, completedClassIds]
  );
  const livePercent =
    allClasses.length > 0
      ? Math.round((completedHere / allClasses.length) * 100)
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

  /** Marca (o desmarca) una lección en el estado local. */
  const setClassCompleted = useCallback(
    (classId: string, completed: boolean) =>
      setCompletedClassIds((prev) => {
        if (prev.has(classId) === completed) return prev;
        const next = new Set(prev);
        if (completed) next.add(classId);
        else next.delete(classId);
        return next;
      }),
    []
  );

  /** Igual, para la introducción del módulo — vive en otra tabla. */
  const setModuleCompleted = useCallback(
    (moduleId: string, completed: boolean) =>
      setCompletedModuleIds((prev) => {
        if (prev.has(moduleId) === completed) return prev;
        const next = new Set(prev);
        if (completed) next.add(moduleId);
        else next.delete(moduleId);
        return next;
      }),
    []
  );

  const selectItem = (id: string) => {
    setSelectedId(id);
    router.replace(`/miembros/curso/${productId}?c=${id}`, { scroll: false });
    // Volver arriba al cambiar de lección: quedarse a media página de la
    // anterior es de las cosas que más desorientan en un curso largo.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /**
   * Auto-completado por permanencia.
   *
   * Nadie va a pulsar «marcar como completada» en cuarenta y siete lecciones.
   * Si alguien se queda el tiempo que la lección tarda en leerse o verse, se da
   * por hecha; si pasa de largo antes de ese umbral, no. El temporizador se
   * cancela al cambiar de lección, así que hojear el temario no marca nada.
   *
   * Los cuestionarios y los ejercicios quedan fuera: tienen su propia señal
   * —aprobar, responder— y esa manda.
   */
  useEffect(() => {
    if (!isCurrent || !selectedClass) return;
    if (completedClassIds.has(selectedClass.id)) return;
    if (selectedClass.contentType === "QUIZ" || selectedClass.contentType === "EXERCISE") {
      return;
    }

    const dwellSec =
      selectedClass.contentType === "TEXT"
        ? Math.max(25, readingMinutes(selectedClass.bodyMd) * 60 * 0.5)
        : selectedClass.contentType === "PDF"
          ? 20
          : selectedClass.recordingDurationSec
            ? Math.max(30, selectedClass.recordingDurationSec * 0.6)
            : 45;

    const timer = setTimeout(() => {
      setClassCompleted(selectedClass.id, true);
      void fetch(`/api/miembros/classes/${selectedClass.id}/progress`, {
        method: "POST",
      });
    }, dwellSec * 1000);

    return () => clearTimeout(timer);
    // `completedClassIds` a propósito fuera: solo interesa su valor al entrar en
    // la lección, y meterlo reiniciaría el reloj en cada cambio de progreso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass?.id, isCurrent, setClassCompleted]);

  /**
   * Lo mismo para la introducción del módulo.
   *
   * Va en su propio efecto porque la introducción **no es una clase**: no está
   * en `modules[].classes` y su progreso vive en `CourseModuleProgress`. Al no
   * tenerlo, era la única entrada del temario que no se completaba nunca sola.
   */
  useEffect(() => {
    if (!isCurrent || !selectedReadingModule) return;
    if (completedModuleIds.has(selectedReadingModule.id)) return;

    const dwellSec = Math.max(20, readingMinutes(selectedReadingModule.bodyMd) * 60 * 0.5);
    const moduleId = selectedReadingModule.id;

    const timer = setTimeout(() => {
      setModuleCompleted(moduleId, true);
      void fetch(`/api/miembros/modules/${moduleId}/progress`, { method: "POST" });
    }, dwellSec * 1000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReadingModule?.id, isCurrent, setModuleCompleted]);

  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
        {/* El progreso vive en la cabecera, no dentro del área que hace scroll:
            ahí era un hijo flexible junto al acordeón del temario y se
            aplastaba hasta cortar su propio texto. */}
        <SidebarHeader className="gap-0 border-b border-sidebar-border px-4 py-4">
          <p className="text-sm leading-none tracking-[0.14em] uppercase">Dayana Beltrán</p>
          <p className="mt-1 text-[9px] tracking-[0.45em] text-muted-foreground uppercase">
            Portal del curso
          </p>
          <p className="mt-4 text-sm leading-snug font-semibold text-balance text-sidebar-foreground">
            {courseTitle}
          </p>
          {isCurrent && allClasses.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {completedHere} de {allClasses.length} clases
                </span>
                <span className="font-medium text-sidebar-foreground">{livePercent}%</span>
              </div>
              <Progress value={livePercent} className="h-1.5" />
            </div>
          )}
        </SidebarHeader>
        <SidebarContent className="px-2 py-2">
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
            {/* Solo donde la barra lateral no está: en escritorio el progreso
                ya vive en su cabecera y aquí solo apretaba la fila. */}
            {isCurrent && (
              <div className="w-32 shrink-0 lg:hidden">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Progreso</span>
                  <span className="font-medium text-foreground">{livePercent}%</span>
                </div>
                <Progress value={livePercent} />
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {/* Ésta es ya la única cabecera del reproductor: `PortalSidebar`
                  hace early-return aquí y no pinta la suya, así que la campana
                  vive en este lado. */}
              <MemberNotificationBell className="-my-1" />
              {/* Eran dos enlaces de texto sueltos —«Mi cuenta» y «Salir»—, y
                  éste era el único sitio del producto donde la identidad no se
                  representaba con el avatar. Ahora es el mismo control que
                  arriba a la derecha en el resto del sitio. */}
              <PortalUserMenu
                displayName={viewerName}
                avatarUrl={viewerAvatarUrl}
                isOwner={viewerIsOwner}
              />
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
                  render={<Link href="/cursos" />}
                >
                  {neverPaid ? "Activar acceso" : "Renovar ahora"}
                </Button>
              </CardContent>
            </Card>
          ) : selectedReadingModule ? (
            <article className="mx-auto max-w-3xl space-y-6">
              <LessonHeader
                moduleIndex={currentBreadcrumb?.moduleIndex}
                kind="Introducción del módulo"
                title={selectedReadingModule.title}
                meta={`${readingMinutes(selectedReadingModule.bodyMd)} min de lectura`}
                action={
                  <ModuleCompleteToggle
                    moduleId={selectedReadingModule.id}
                    completed={completedModuleIds.has(selectedReadingModule.id)}
                    onChange={(completed) =>
                      setModuleCompleted(selectedReadingModule.id, completed)
                    }
                  />
                }
              />
              <LessonProse>{selectedReadingModule.bodyMd || ""}</LessonProse>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
                <ModuleCompleteToggle
                  moduleId={selectedReadingModule.id}
                  completed={completedModuleIds.has(selectedReadingModule.id)}
                  onChange={(completed) =>
                    setModuleCompleted(selectedReadingModule.id, completed)
                  }
                  size="default"
                />
                <p className="text-xs text-muted-foreground">
                  {completedModuleIds.has(selectedReadingModule.id)
                    ? "Ya la tienes marcada."
                    : "También se marca sola cuando pasas aquí el tiempo suficiente."}
                </p>
              </div>
            </article>
          ) : !selectedClass ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                El contenido de este curso se publicará aquí pronto.
              </CardContent>
            </Card>
          ) : selectedClass.contentType !== "VIDEO" ? (
            <article className="mx-auto max-w-3xl space-y-6">
              <LessonHeader
                moduleIndex={currentBreadcrumb?.moduleIndex}
                kind={
                  selectedClass.contentType === "TEXT"
                    ? "Lectura"
                    : selectedClass.contentType === "PDF"
                      ? "Material descargable"
                      : selectedClass.contentType === "EXERCISE"
                        ? "Ejercicio"
                        : "Cuestionario"
                }
                title={selectedClass.title}
                description={selectedClass.description}
                meta={
                  selectedClass.contentType === "TEXT"
                    ? `${readingMinutes(selectedClass.bodyMd)} min de lectura`
                    : selectedClass.contentType === "QUIZ"
                      ? `${selectedClass.quiz?.questions.length ?? 0} preguntas`
                      : selectedClass.contentType === "EXERCISE"
                        ? "Se guarda solo"
                        : selectedClass.materialSizeBytes != null
                          ? `PDF · ${(selectedClass.materialSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                          : "PDF"
                }
                action={
                  // El cuestionario se aprueba y el ejercicio se responde: en
                  // esos dos, marcar a mano sobraría.
                  selectedClass.contentType !== "QUIZ" &&
                  selectedClass.contentType !== "EXERCISE" ? (
                    <ClassCompleteToggle
                      classId={selectedClass.id}
                      completed={completedClassIds.has(selectedClass.id)}
                      onChange={(completed) =>
                        setClassCompleted(selectedClass.id, completed)
                      }
                    />
                  ) : completedClassIds.has(selectedClass.id) ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                      <Check className="size-3.5" aria-hidden />
                      Completada
                    </span>
                  ) : undefined
                }
              />

              {selectedClass.contentType === "TEXT" && (
                <LessonProse>{selectedClass.bodyMd || "*Sin contenido*"}</LessonProse>
              )}

              {selectedClass.contentType === "PDF" && (
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {selectedClass.materialFileName ?? "Material del módulo"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedClass.materialFileName
                          ? selectedClass.materialSizeBytes != null
                            ? `PDF · ${(selectedClass.materialSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                            : "PDF"
                          : "Todavía no está disponible para descargar."}
                      </p>
                    </div>
                    {selectedClass.materialFileName && (
                      <Button
                        nativeButton={false}
                        render={<a href={`/api/miembros/classes/${selectedClass.id}/material`} />}
                      >
                        <Download />
                        Descargar
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedClass.contentType === "QUIZ" &&
                (selectedClass.quiz && selectedClass.quiz.questions.length > 0 ? (
                  <QuizPlayer
                    key={selectedClass.id}
                    classId={selectedClass.id}
                    quiz={selectedClass.quiz}
                    alreadyCompleted={completedClassIds.has(selectedClass.id)}
                    onSubmitted={() => setClassCompleted(selectedClass.id, true)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Este cuestionario aún no tiene preguntas.
                  </p>
                ))}

              {selectedClass.contentType === "EXERCISE" &&
                (selectedClass.exercise ? (
                  <ExercisePlayer
                    key={selectedClass.id}
                    classId={selectedClass.id}
                    exercise={selectedClass.exercise}
                    onCompletedChange={(completed) =>
                      setClassCompleted(selectedClass.id, completed)
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Este ejercicio todavía no tiene preguntas.
                  </p>
                ))}

              {selectedClass.contentType !== "QUIZ" &&
                selectedClass.contentType !== "EXERCISE" && (
                  <LessonFooterComplete
                    classId={selectedClass.id}
                    completed={completedClassIds.has(selectedClass.id)}
                    onChange={(completed) =>
                      setClassCompleted(selectedClass.id, completed)
                    }
                  />
                )}

              <div className="border-t border-border pt-6">
                <LessonComments
                  key={selectedClass.id}
                  classId={selectedClass.id}
                  viewerContactId={viewerContactId}
                />
              </div>
            </article>
          ) : (
            // El video se pinta arriba y la cabecera debajo: el reproductor es
            // lo que la persona vino a ver. Antes esta rama repetía el bloque de
            // título dos veces, uno por cada estado de la grabación.
            <article className="mx-auto max-w-3xl space-y-6">
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
                      Próxima sesión en vivo:{" "}
                      <LocalInstantText
                        startsAtIso={selectedClass.scheduledAt}
                        mode="datetimeWithPlace"
                      />
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
                    Esta clase todavía no tiene video. Te avisamos en cuanto esté.
                  </CardContent>
                </Card>
              )}

              <LessonHeader
                moduleIndex={currentBreadcrumb?.moduleIndex}
                kind="Clase en video"
                title={selectedClass.title}
                description={selectedClass.description}
                meta={
                  selectedClass.recordingDurationSec
                    ? `${Math.max(1, Math.round(selectedClass.recordingDurationSec / 60))} min`
                    : undefined
                }
                action={
                  <ClassCompleteToggle
                    classId={selectedClass.id}
                    completed={completedClassIds.has(selectedClass.id)}
                    onChange={(completed) =>
                      setClassCompleted(selectedClass.id, completed)
                    }
                  />
                }
              />

              <LessonFooterComplete
                classId={selectedClass.id}
                completed={completedClassIds.has(selectedClass.id)}
                onChange={(completed) => setClassCompleted(selectedClass.id, completed)}
              />

              <div>
                <LessonComments
                  key={selectedClass.id}
                  classId={selectedClass.id}
                  viewerContactId={viewerContactId}
                />
              </div>
            </article>
          )}

          {isCurrent && (prevItem || nextItem) && (
            <div className="mx-auto mt-10 flex max-w-3xl items-center justify-between gap-3 border-t border-border pt-4">
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
