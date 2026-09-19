"use client";

import { CalendarCheck2, FileText, ListChecks, Video } from "lucide-react";
import LocalInstantText from "@/app/components/datetime/LocalInstantText";
import { buildWhatsAppUrl } from "@/lib/contact";

type Props = {
  title: string;
  startsAtIso: string | null;
  dateLabel: string | null;
  scheduleLabel: string | null;
  userCountry?: string | null;
  /** `null` = todavía no hay enlace (se avisa que llega antes del taller). */
  meetingUrl: string | null;
  documentsCount: number;
  hasSchedule: boolean;
};

/**
 * Confirmación post-pago al tope de `WorkshopLanding` — solo se monta ahí,
 * que a su vez solo se renderiza para quien ya pagó o para el preview de
 * OWNER (ver app/taller-virtual/[slug]/page.tsx), así que no hace falta un
 * chequeo de acceso aquí dentro.
 */
const WorkshopEnrolledBanner = ({
  title,
  startsAtIso,
  dateLabel,
  scheduleLabel,
  userCountry = null,
  meetingUrl,
  documentsCount,
  hasSchedule,
}: Props) => {
  const whatsappHref = buildWhatsAppUrl(
    `Hola Dayana, tengo un problema para entrar al taller "${title}".`
  );

  const fallbackWhen =
    [dateLabel, scheduleLabel].filter(Boolean).join(" · ") ||
    "Pronto te confirmamos la fecha.";

  return (
    <div className="wk-reveal rounded-3xl border border-emerald-700/25 bg-emerald-700/[0.06] p-6 lg:p-8">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/30 bg-emerald-700 px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em] text-white">
        <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden />
        Ya estás inscrita
      </span>

      <p className="mt-3 font-[font1] text-base leading-snug text-black/80 lg:text-lg">
        Tu pago está confirmado.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/50">
            Cuándo
          </div>
          <div className="mt-1 font-[font1] text-lg leading-snug text-black">
            {startsAtIso ? (
              <LocalInstantText
                startsAtIso={startsAtIso}
                mode="datetimeWithPlace"
                userCountry={userCountry}
                placeholder={fallbackWhen}
              />
            ) : (
              fallbackWhen
            )}
          </div>
          <p className="mt-1 font-[font1] text-xs text-black/50">
            Conéctate unos minutos antes para probar audio y video.
          </p>
        </div>

        <div className="min-w-0">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/50">
            Reunión
          </div>
          {meetingUrl ? (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-terracotta px-6 py-3 font-[font2] text-xs uppercase tracking-[0.24em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c]"
            >
              <Video className="h-4 w-4" aria-hidden />
              Entrar a la reunión
            </a>
          ) : (
            <p className="mt-1 font-[font1] text-sm leading-snug text-black/65">
              Te enviaremos el enlace de la reunión antes del taller.
            </p>
          )}
        </div>
      </div>

      {documentsCount > 0 || hasSchedule ? (
        <div className="mt-5 flex flex-wrap gap-2.5">
          {documentsCount > 0 ? (
            <a
              href="#materiales"
              className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2 font-[font1] text-sm text-black/75 transition-colors hover:border-black/30"
            >
              <FileText className="h-4 w-4 text-terracotta" aria-hidden />
              {documentsCount === 1 ? "1 material" : `${documentsCount} materiales`}
            </a>
          ) : null}
          {hasSchedule ? (
            <a
              href="#cronograma"
              className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2 font-[font1] text-sm text-black/75 transition-colors hover:border-black/30"
            >
              <ListChecks className="h-4 w-4 text-terracotta" aria-hidden />
              Ver el cronograma
            </a>
          ) : null}
        </div>
      ) : null}

      <p className="mt-5 font-[font1] text-xs leading-snug text-black/50">
        ¿Algo no funciona?{" "}
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-terracotta underline decoration-terracotta/30 underline-offset-2"
        >
          Escríbele a Dayana
        </a>
      </p>
    </div>
  );
};

export default WorkshopEnrolledBanner;
