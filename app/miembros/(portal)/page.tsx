import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Video } from "lucide-react";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import {
  getClassesForCourse,
  getPublishedModules,
  isRecordingVisible,
  recordingDaysLeft,
} from "@/lib/lms/course-content";
import MembershipStatusCard from "@/app/components/miembros/MembershipStatusCard";
import DriveRecordingEmbed from "@/app/components/miembros/DriveRecordingEmbed";

export const metadata: Metadata = {
  title: `Portal de miembros — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const formatDateTime = (date: Date) =>
  `${date.toLocaleDateString("es-CO", { dateStyle: "full" })} · ${date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

const Page = async () => {
  const { contact, membership, courseProduct } = await requirePortalContext();
  const isCurrent = membership.isCurrent;

  const [{ upcoming, past, now }, modules] = courseProduct
    ? await Promise.all([
        getClassesForCourse(courseProduct.id),
        getPublishedModules(courseProduct.id),
      ])
    : [{ upcoming: [], past: [], now: new Date() }, []];

  const nextClass = upcoming[0] ?? null;
  const latestRecording = past.find((c) => isRecordingVisible(c, now)) ?? null;
  const visibleRecordings = past.filter((c) => isRecordingVisible(c, now)).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="portal-display text-[11px] text-[var(--portal-muted)]">
          Hola, {contact.firstName}
        </div>
        <h1 className="portal-display mt-1 text-2xl text-[var(--portal-foreground)] lg:text-3xl">
          {courseProduct?.title ?? "Portal de miembros"}
        </h1>
      </div>

      <MembershipStatusCard
        paidUntil={membership.paidUntil}
        isCurrent={isCurrent}
        daysLeft={membership.daysLeft}
        hasEnrollment={membership.enrollment != null}
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="portal-card p-4">
          <div className="portal-display flex items-center gap-2 text-[10px] text-[var(--portal-muted)]">
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
        </div>
        <div className="portal-card p-4">
          <div className="portal-display flex items-center gap-2 text-[10px] text-[var(--portal-muted)]">
            <Video className="size-3.5" aria-hidden /> Grabaciones activas
          </div>
          <div className="mt-2 text-sm font-semibold">{visibleRecordings}</div>
        </div>
        <div className="portal-card p-4">
          <div className="portal-display flex items-center gap-2 text-[10px] text-[var(--portal-muted)]">
            <BookOpen className="size-3.5" aria-hidden /> Módulos publicados
          </div>
          <div className="mt-2 text-sm font-semibold">{modules.length}</div>
        </div>
      </div>

      {/* Next class */}
      <section className="portal-card p-5 sm:p-6">
        <h2 className="portal-display text-[11px] text-[var(--portal-muted)]">
          Próxima clase en vivo
        </h2>
        {nextClass?.scheduledAt ? (
          <div className="mt-3">
            <div className="text-base font-semibold">{nextClass.title}</div>
            <div className="mt-1 text-sm text-[var(--portal-muted)]">
              {formatDateTime(nextClass.scheduledAt)}
            </div>
            {nextClass.description ? (
              <p className="mt-3 text-sm leading-relaxed text-[#33302b]">
                {nextClass.description}
              </p>
            ) : null}
            {isCurrent && nextClass.meetUrl ? (
              <a
                href={nextClass.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-btn-primary mt-4"
              >
                Unirme por Google Meet
              </a>
            ) : !isCurrent ? (
              <p className="mt-3 text-xs text-[var(--portal-danger)]">
                Renueva tu mensualidad para ver el enlace de la clase.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--portal-muted)]">
            Aún no hay una próxima clase programada. Te avisaremos por correo y
            WhatsApp.
          </p>
        )}
      </section>

      {/* Latest recording */}
      <section className="portal-card p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="portal-display text-[11px] text-[var(--portal-muted)]">
            Última grabación
          </h2>
          <Link
            href="/miembros/clases"
            className="inline-flex items-center gap-1 text-xs text-[var(--portal-accent)] hover:underline"
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
              <div className="flex items-center justify-between text-xs text-[var(--portal-muted)]">
                <span className="font-medium text-[var(--portal-foreground)]">
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
            <p className="mt-3 text-sm text-[#33302b]">
              Hay una grabación reciente esperándote. Renueva tu mensualidad
              para verla.
            </p>
          )
        ) : (
          <p className="mt-3 text-sm text-[var(--portal-muted)]">
            Todavía no hay grabaciones disponibles.
          </p>
        )}
      </section>

      {/* Modules */}
      <section className="portal-card p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="portal-display text-[11px] text-[var(--portal-muted)]">
            Módulos del curso
          </h2>
          <Link
            href="/miembros/modulos"
            className="inline-flex items-center gap-1 text-xs text-[var(--portal-accent)] hover:underline"
          >
            Ver todos <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        {modules.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--portal-border)]">
            {modules.slice(0, 4).map((mod, i) => (
              <li key={mod.id}>
                <Link
                  href={
                    isCurrent ? `/miembros/modulos/${mod.id}` : "/miembros/cuenta"
                  }
                  className="flex items-center gap-4 py-3 transition-colors hover:bg-[rgba(236,227,212,0.35)]"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(212,184,150,0.3)] text-xs font-semibold text-[var(--portal-accent)]">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{mod.title}</span>
                  {!isCurrent && (
                    <span className="portal-display ml-auto text-[9px] text-[var(--portal-muted)]">
                      Bloqueado
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--portal-muted)]">
            Los módulos se publicarán aquí muy pronto.
          </p>
        )}
      </section>
    </div>
  );
};

export default Page;
