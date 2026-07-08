import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Video } from "lucide-react";
import { Check } from "lucide-react";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import {
  getClassesForCourse,
  getPublishedModules,
  isRecordingVisible,
  recordingDaysLeft,
} from "@/lib/lms/course-content";
import { getCompletedModuleIds } from "@/lib/lms/module-progress";
import MembershipStatusCard from "@/app/components/miembros/MembershipStatusCard";
import DriveRecordingEmbed from "@/app/components/miembros/DriveRecordingEmbed";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

export const metadata: Metadata = {
  title: `Portal de miembros — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const formatDateTime = (date: Date) =>
  `${date.toLocaleDateString("es-CO", { dateStyle: "full" })} · ${date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

const Page = async () => {
  const { contact, membership, courseProduct } = await requirePortalContext();
  const isCurrent = membership.isCurrent;

  const [{ upcoming, past, now }, modules, completedIds] = courseProduct
    ? await Promise.all([
        getClassesForCourse(courseProduct.id),
        getPublishedModules(courseProduct.id),
        getCompletedModuleIds(contact.id),
      ])
    : [{ upcoming: [], past: [], now: new Date() }, [], new Set<string>()];

  const nextClass = upcoming[0] ?? null;
  const latestRecording = past.find((c) => isRecordingVisible(c, now)) ?? null;
  const visibleRecordings = past.filter((c) => isRecordingVisible(c, now)).length;
  const completedCount = modules.filter((m) => completedIds.has(m.id)).length;
  const continueModule =
    isCurrent && modules.length > 0
      ? (modules.find((m) => !completedIds.has(m.id)) ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Hola, {contact.firstName}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
          {courseProduct?.title ?? "Portal de miembros"}
        </h1>
      </div>

      <MembershipStatusCard
        paidUntil={membership.paidUntil}
        isCurrent={isCurrent}
        daysLeft={membership.daysLeft}
        hasEnrollment={membership.enrollment != null}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
              <CalendarDays className="size-3.5" aria-hidden /> Próxima clase
            </div>
            <div className="mt-2 text-sm font-semibold">
              {nextClass?.scheduledAt
                ? nextClass.scheduledAt.toLocaleDateString("es-CO", {
                    day: "numeric",
                    month: "long",
                  })
                : "Por programar"}
            </div>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
              <Video className="size-3.5" aria-hidden /> Grabaciones activas
            </div>
            <div className="mt-2 text-sm font-semibold">{visibleRecordings}</div>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide">
              <BookOpen className="size-3.5" aria-hidden /> Módulos
            </div>
            <div className="mt-2 text-sm font-semibold">
              {isCurrent ? `${completedCount}/${modules.length}` : modules.length}
              {isCurrent && modules.length > 0 ? " completados" : ""}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Próxima clase en vivo
          </h2>
          {nextClass?.scheduledAt ? (
            <div className="mt-3">
              <div className="text-base font-semibold">{nextClass.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(nextClass.scheduledAt)}
              </div>
              {nextClass.description ? (
                <p className="mt-3 text-sm leading-relaxed">
                  {nextClass.description}
                </p>
              ) : null}
              {isCurrent && nextClass.meetUrl ? (
                <Button
                  className="mt-4"
                  nativeButton={false}
                  render={
                    <a href={nextClass.meetUrl} target="_blank" rel="noopener noreferrer" />
                  }
                >
                  Unirme por Google Meet
                </Button>
              ) : !isCurrent ? (
                <p className="mt-3 text-xs text-destructive">
                  Renueva tu mensualidad para ver el enlace de la clase.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Aún no hay una próxima clase programada. Te avisaremos por correo y
              WhatsApp.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Última grabación
            </h2>
            <Link
              href="/miembros/clases"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Ver todas <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          {latestRecording?.recordingPostedAt ? (
            isCurrent ? (
              <div className="mt-4 space-y-2">
                <DriveRecordingEmbed
                  url={latestRecording.recordingUrl!}
                  title={latestRecording.title}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {latestRecording.title}
                  </span>
                  <span>
                    Disponible{" "}
                    {recordingDaysLeft(latestRecording.recordingPostedAt)} días
                    más
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm">
                Hay una grabación reciente esperándote. Renueva tu mensualidad
                para verla.
              </p>
            )
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Todavía no hay grabaciones disponibles.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Módulos del curso
            </h2>
            <Link
              href="/miembros/modulos"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Ver todos <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>

          {continueModule && (
            <Button
              className="mt-3"
              size="sm"
              nativeButton={false}
              render={<Link href={`/miembros/modulos/${continueModule.id}`} />}
            >
              {completedCount > 0 ? "Continuar" : "Empezar"}: {continueModule.title}
            </Button>
          )}

          {modules.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {modules.slice(0, 4).map((mod, i) => {
                const completed = completedIds.has(mod.id);
                return (
                  <li key={mod.id}>
                    <Link
                      href={
                        isCurrent ? `/miembros/modulos/${mod.id}` : "/miembros/cuenta"
                      }
                      className="flex items-center gap-4 py-3 transition-colors hover:bg-secondary/40"
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          completed
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-accent/40 text-primary"
                        }`}
                      >
                        {completed ? <Check className="size-3.5" /> : i + 1}
                      </span>
                      <span className="text-sm font-medium">{mod.title}</span>
                      {!isCurrent && (
                        <span className="ml-auto text-[9px] text-muted-foreground uppercase tracking-wide">
                          Bloqueado
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Los módulos se publicarán aquí muy pronto.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Page;
