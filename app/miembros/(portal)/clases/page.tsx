import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import {
  getClassesForCourse,
  isRecordingVisible,
  recordingDaysLeft,
} from "@/lib/lms/course-content";
import DriveRecordingEmbed from "@/app/components/miembros/DriveRecordingEmbed";

export const metadata: Metadata = {
  title: `Clases — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const formatDateTime = (date: Date) =>
  `${date.toLocaleDateString("es-CO", { dateStyle: "full" })} · ${date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

const formatDate = (date: Date) =>
  date.toLocaleDateString("es-CO", { dateStyle: "long" });

const Page = async () => {
  const { membership, courseProduct } = await requirePortalContext();
  const isCurrent = membership.isCurrent;

  const { upcoming, past, now } = courseProduct
    ? await getClassesForCourse(courseProduct.id)
    : { upcoming: [], past: [], now: new Date() };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="portal-display text-2xl text-[var(--portal-foreground)] lg:text-3xl">
          Tus clases
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--portal-muted)]">
          Las clases son en vivo por Google Meet. La grabación queda disponible
          aquí durante un mes.
        </p>
      </div>

      {!isCurrent && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Tu mensualidad no está al día — los enlaces y grabaciones están
          bloqueados.{" "}
          <Link
            href="/miembros/cuenta"
            className="font-semibold underline underline-offset-4"
          >
            Renueva aquí
          </Link>
          .
        </div>
      )}

      <section>
        <h2 className="portal-display mb-3 text-[11px] text-[var(--portal-muted)]">
          Próximas
        </h2>
        {upcoming.length > 0 ? (
          <ul className="space-y-3">
            {upcoming.map((cls) => (
              <li key={cls.id} className="portal-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold">{cls.title}</div>
                    {cls.scheduledAt ? (
                      <div className="mt-1 text-sm text-[var(--portal-muted)]">
                        {formatDateTime(cls.scheduledAt)}
                      </div>
                    ) : null}
                    {cls.description ? (
                      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#33302b]">
                        {cls.description}
                      </p>
                    ) : null}
                  </div>
                  {isCurrent && cls.meetUrl ? (
                    <a
                      href={cls.meetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="portal-btn-primary"
                    >
                      Google Meet
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--portal-muted)]">
            No hay clases programadas por ahora.
          </p>
        )}
      </section>

      <section>
        <h2 className="portal-display mb-3 text-[11px] text-[var(--portal-muted)]">
          Grabaciones
        </h2>
        {past.length > 0 ? (
          <ul className="space-y-4">
            {past.map((cls) => {
              const visible = isRecordingVisible(cls, now);
              return (
                <li key={cls.id} className="portal-card p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="text-base font-semibold">
                        {cls.title}
                      </span>
                      {cls.scheduledAt ? (
                        <span className="ml-3 text-xs text-[var(--portal-muted)]">
                          {formatDate(cls.scheduledAt)}
                        </span>
                      ) : null}
                    </div>
                    {visible && cls.recordingPostedAt ? (
                      <span className="portal-display rounded-full bg-[rgba(237,195,177,0.4)] px-3 py-1 text-[9px] text-[var(--portal-accent)]">
                        {recordingDaysLeft(cls.recordingPostedAt, now)} días más
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    {visible ? (
                      isCurrent ? (
                        <DriveRecordingEmbed
                          url={cls.recordingUrl!}
                          title={cls.title}
                        />
                      ) : (
                        <p className="text-sm text-[#33302b]">
                          Grabación disponible — renueva tu mensualidad para
                          verla.
                        </p>
                      )
                    ) : (
                      <p className="text-sm text-[var(--portal-muted)]">
                        {cls.recordingUrl || cls.recordingHiddenAt
                          ? "La grabación de esta clase ya no está disponible (las grabaciones duran un mes)."
                          : "Esta clase no tiene grabación disponible."}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[var(--portal-muted)]">
            Aquí aparecerán las grabaciones de las clases pasadas.
          </p>
        )}
      </section>
    </div>
  );
};

export default Page;
