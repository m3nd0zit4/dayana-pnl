import type { Metadata } from "next";
import Link from "next/link";
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
  const latestRecording =
    past.find((c) => isRecordingVisible(c, now)) ?? null;

  return (
    <div className="space-y-10">
      <div>
        <div className="mb-3 font-[font2] uppercase text-xs tracking-[0.4em] text-linen/70">
          Hola, {contact.firstName}
        </div>
        <h1 className="font-[font2] uppercase text-3xl leading-[0.95] lg:text-5xl">
          {courseProduct?.title ?? "Portal de miembros"}
        </h1>
      </div>

      <MembershipStatusCard
        paidUntil={membership.paidUntil}
        isCurrent={isCurrent}
        daysLeft={membership.daysLeft}
        hasEnrollment={membership.enrollment != null}
      />

      <section>
        <h2 className="mb-4 font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
          Próxima clase en vivo
        </h2>
        {nextClass?.scheduledAt ? (
          <div className="rounded-2xl border border-linen/15 bg-linen/[0.04] p-6">
            <div className="font-[font1] text-lg text-white">
              {nextClass.title}
            </div>
            <div className="mt-1 font-[font1] text-sm text-white/60">
              {formatDateTime(nextClass.scheduledAt)}
            </div>
            {nextClass.description ? (
              <p className="mt-3 font-[font1] text-sm leading-relaxed text-white/70">
                {nextClass.description}
              </p>
            ) : null}
            {isCurrent && nextClass.meetUrl ? (
              <a
                href={nextClass.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-block rounded-full bg-linen px-7 py-3 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white"
              >
                Unirme por Google Meet
              </a>
            ) : !isCurrent ? (
              <p className="mt-4 font-[font1] text-xs text-blush">
                Renueva tu mensualidad para ver el enlace de la clase.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            Aún no hay una próxima clase programada. Te avisaremos por correo y
            WhatsApp.
          </p>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
            Última grabación
          </h2>
          <Link
            href="/miembros/clases"
            className="font-[font1] text-xs text-linen underline-offset-4 hover:underline"
          >
            Ver todas
          </Link>
        </div>
        {latestRecording?.recordingPostedAt ? (
          isCurrent ? (
            <div className="space-y-3">
              <DriveRecordingEmbed
                url={latestRecording.recordingUrl!}
                title={latestRecording.title}
              />
              <div className="flex items-center justify-between font-[font1] text-xs text-white/50">
                <span>{latestRecording.title}</span>
                <span>
                  Disponible {recordingDaysLeft(latestRecording.recordingPostedAt)}{" "}
                  días más
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-linen/15 bg-linen/[0.04] p-6 font-[font1] text-sm text-white/70">
              Hay una grabación reciente esperándote. Renueva tu mensualidad
              para verla.
            </div>
          )
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            Todavía no hay grabaciones disponibles.
          </p>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
            Módulos del curso
          </h2>
          <Link
            href="/miembros/modulos"
            className="font-[font1] text-xs text-linen underline-offset-4 hover:underline"
          >
            Ver todos
          </Link>
        </div>
        {modules.length > 0 ? (
          <ul className="space-y-2">
            {modules.slice(0, 3).map((mod, i) => (
              <li key={mod.id}>
                <Link
                  href={isCurrent ? `/miembros/modulos/${mod.id}` : "/miembros/cuenta"}
                  className="flex items-center gap-4 rounded-xl border border-linen/10 bg-linen/[0.03] px-5 py-4 transition-colors hover:border-linen/25"
                >
                  <span className="font-[font2] text-xs text-white/35">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[font1] text-sm text-white/85">
                    {mod.title}
                  </span>
                  {!isCurrent && (
                    <span className="ml-auto font-[font2] uppercase text-[9px] tracking-[0.2em] text-white/40">
                      Bloqueado
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            Los módulos se publicarán aquí muy pronto.
          </p>
        )}
      </section>
    </div>
  );
};

export default Page;
