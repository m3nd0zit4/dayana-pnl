import Link from "next/link";
import { ArrowRight, CalendarCheck, Download } from "lucide-react";
import type { FreeWebinarPublic } from "@/lib/crm/free-webinar";
import { FREE_EVENT_PATH } from "@/lib/crm/free-webinar-publish";

type Props = {
  event: FreeWebinarPublic;
  /** El evento abierto ahora, si lo hay: a dónde mandar a quien llegó tarde. */
  openEvent: FreeWebinarPublic | null;
  /** La web todavía sirve su material (`isFreeEventMaterialDownloadable`). */
  materialDownloadable: boolean;
  /** Fecha legible en la zona del CRM. */
  dateLabel: string;
};

/**
 * La página de un evento que ya no acepta inscripciones: o ya pasó, o cerró
 * inscripciones porque se publicó el siguiente. En vez de un 404 dice qué pasó
 * y lleva al evento abierto — es a donde llegan los enlaces viejos.
 */
const FreeEventEndedPage = ({ event, openEvent, materialDownloadable, dateLabel }: Props) => {
  const happened = Boolean(event.endedAt) || event.status === "COMPLETED";
  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#f0ece4] px-5 py-14 text-black lg:px-12 lg:py-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[45vh] bg-[radial-gradient(ellipse_at_20%_0%,rgba(237,195,177,0.5),transparent_55%)]"
      />
      <div className="relative mx-auto max-w-2xl">
        <span className="inline-flex rounded-full border border-black/10 bg-white/55 px-3.5 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/60">
          {event.eventLabel}
        </span>
        <h1 className="mt-4 font-[font2] text-[clamp(1.6rem,4.4vw,2.6rem)] uppercase leading-[0.98] tracking-tight">
          {event.headline}
        </h1>
        <p className="mt-4 flex items-center gap-2 font-[font1] text-sm text-black/60">
          <CalendarCheck className="h-4 w-4 shrink-0 text-terracotta" />
          {dateLabel}
        </p>

        <div className="mt-8 rounded-[1.25rem] border border-white/50 bg-white/60 p-5 shadow-[0_24px_60px_-28px_rgba(92,74,58,0.45)] backdrop-blur-xl lg:p-7">
          <h2 className="font-[font2] text-lg uppercase tracking-wide">
            {happened ? "Este evento ya pasó" : "Las inscripciones a este evento ya cerraron"}
          </h2>
          <p className="mt-2 font-[font1] text-sm leading-relaxed text-black/65">
            {happened
              ? "Gracias a todas las que estuvieron. Si te lo perdiste, el próximo encuentro está esperándote."
              : "Si ya te inscribiste, te llega el enlace y los recordatorios como siempre."}
          </p>

          {materialDownloadable && event.materialFileName ? (
            <a
              href={`/api/webinar/material?evento=${encodeURIComponent(event.id)}`}
              className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-black/10 bg-white/70 px-4 py-2.5 font-[font1] text-sm text-black/75 transition-colors hover:border-terracotta/40 hover:text-terracotta"
            >
              <Download className="h-4 w-4 text-terracotta" />
              {event.materialLabel?.trim() || "Descargar material"}
            </a>
          ) : null}

          {openEvent && openEvent.id !== event.id ? (
            <div className="mt-6 border-t border-black/10 pt-5">
              <p className="font-[font2] text-[11px] uppercase tracking-[0.2em] text-black/50">
                Próximo evento gratuito
              </p>
              <p className="mt-1.5 font-[font1] text-base text-black/85">{openEvent.headline}</p>
              <Link
                href={FREE_EVENT_PATH}
                className="mt-4 inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-7 py-3.5 font-[font2] text-xs uppercase tracking-[0.24em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c]"
              >
                {openEvent.ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <Link
              href="/enlaces"
              className="mt-6 inline-flex items-center gap-2 font-[font1] text-sm text-terracotta underline-offset-4 hover:underline"
            >
              Ver todo lo que hay ahora
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </main>
  );
};

export default FreeEventEndedPage;
