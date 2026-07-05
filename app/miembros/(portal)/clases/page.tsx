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
    <div className="space-y-12">
      <div>
        <div className="mb-3 font-[font2] uppercase text-xs tracking-[0.4em] text-linen/70">
          Clases en vivo
        </div>
        <h1 className="font-[font2] uppercase text-3xl leading-[0.95] lg:text-5xl">
          Tus clases
        </h1>
        <p className="mt-4 max-w-xl font-[font1] text-sm leading-relaxed text-white/60">
          Las clases son en vivo por Google Meet. La grabación queda disponible
          aquí durante un mes.
        </p>
      </div>

      {!isCurrent && (
        <div className="rounded-2xl border border-blush/25 bg-blush/[0.06] p-5 font-[font1] text-sm text-white/80">
          Tu mensualidad no está al día — los enlaces y grabaciones están
          bloqueados.{" "}
          <Link
            href="/miembros/cuenta"
            className="text-linen underline underline-offset-4"
          >
            Renueva aquí
          </Link>
          .
        </div>
      )}

      <section>
        <h2 className="mb-4 font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
          Próximas
        </h2>
        {upcoming.length > 0 ? (
          <ul className="space-y-3">
            {upcoming.map((cls) => (
              <li
                key={cls.id}
                className="rounded-2xl border border-linen/15 bg-linen/[0.04] p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-[font1] text-lg text-white">
                      {cls.title}
                    </div>
                    {cls.scheduledAt ? (
                      <div className="mt-1 font-[font1] text-sm text-white/60">
                        {formatDateTime(cls.scheduledAt)}
                      </div>
                    ) : null}
                    {cls.description ? (
                      <p className="mt-3 max-w-xl font-[font1] text-sm leading-relaxed text-white/70">
                        {cls.description}
                      </p>
                    ) : null}
                  </div>
                  {isCurrent && cls.meetUrl ? (
                    <a
                      href={cls.meetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-linen px-6 py-3 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white"
                    >
                      Google Meet
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            No hay clases programadas por ahora.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-[font2] uppercase text-sm tracking-[0.3em] text-white/55">
          Grabaciones
        </h2>
        {past.length > 0 ? (
          <ul className="space-y-8">
            {past.map((cls) => {
              const visible = isRecordingVisible(cls, now);
              return (
                <li key={cls.id} className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-[font1] text-base text-white">
                        {cls.title}
                      </span>
                      {cls.scheduledAt ? (
                        <span className="ml-3 font-[font1] text-xs text-white/45">
                          {formatDate(cls.scheduledAt)}
                        </span>
                      ) : null}
                    </div>
                    {visible && cls.recordingPostedAt ? (
                      <span className="font-[font1] text-xs text-blush">
                        Disponible {recordingDaysLeft(cls.recordingPostedAt, now)}{" "}
                        días más
                      </span>
                    ) : null}
                  </div>

                  {visible ? (
                    isCurrent ? (
                      <DriveRecordingEmbed
                        url={cls.recordingUrl!}
                        title={cls.title}
                      />
                    ) : (
                      <div className="rounded-2xl border border-linen/10 bg-linen/[0.03] p-5 font-[font1] text-sm text-white/60">
                        Grabación disponible — renueva tu mensualidad para
                        verla.
                      </div>
                    )
                  ) : (
                    <div className="rounded-2xl border border-linen/10 bg-linen/[0.02] p-5 font-[font1] text-sm text-white/40">
                      {cls.recordingUrl || cls.recordingHiddenAt
                        ? "La grabación de esta clase ya no está disponible (las grabaciones duran un mes)."
                        : "Esta clase no tiene grabación disponible."}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="font-[font1] text-sm text-white/50">
            Aquí aparecerán las grabaciones de las clases pasadas.
          </p>
        )}
      </section>
    </div>
  );
};

export default Page;
