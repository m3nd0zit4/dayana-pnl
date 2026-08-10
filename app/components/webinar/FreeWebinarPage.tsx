"use client";

import { Laptop, Gift, Users, ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import LeadCaptureForm from "@/app/components/leads/LeadCaptureForm";
import WebinarLocalSchedule from "@/app/components/webinar/WebinarLocalSchedule";
import { BRAND } from "@/lib/contact";
import type { FreeWebinarPublic } from "@/lib/crm/free-webinar";
import { WEBINAR_INTEREST_LABEL } from "@/lib/crm/webinar-interest";

type Props = {
  webinar: FreeWebinarPublic;
  userCountry?: string | null;
};

// El bundle de mux-player es pesado y el vídeo va por debajo del pliegue.
// Esta es la landing de conversión: no vale la pena pagarlo en el LCP.
const WebinarMuxVideo = dynamic(
  () => import("@/app/components/webinar/WebinarMuxVideo"),
  {
    ssr: false,
    loading: () => <div className="aspect-video w-full bg-black" />,
  }
);

const scrollToRegistro = () => {
  document.getElementById("registro")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

const FaqItem = ({ q, a }: { q: string; a: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-black/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="font-[font2] text-sm uppercase tracking-wide text-black/85">
          {q}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-terracotta transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <p className="pb-3.5 font-[font1] text-sm leading-relaxed text-black/65">
            {a}
          </p>
        </div>
      </div>
    </div>
  );
};

const FreeWebinarPage = ({ webinar, userCountry }: Props) => {
  const learnTitle = webinar.learnSectionTitle?.trim() || "Lo que vas a llevarte";

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#f0ece4] text-black">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(ellipse_at_20%_0%,rgba(237,195,177,0.5),transparent_55%),radial-gradient(ellipse_at_90%_10%,rgba(212,184,150,0.35),transparent_50%)]"
      />

      <section className="relative px-5 pb-12 pt-12 lg:px-12 lg:pb-16 lg:pt-16 xl:px-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-12">
          <div>
            <span className="inline-flex rounded-full bg-terracotta px-3.5 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.22em] text-white">
              Webinar gratuito
            </span>
            <h1 className="mt-4 font-[font2] text-[clamp(1.85rem,4.8vw,3.25rem)] uppercase leading-[0.95] tracking-tight">
              {webinar.headline}
            </h1>
            {webinar.subheadline && (
              <p className="mt-4 max-w-lg font-[font1] text-base leading-snug text-black/65 lg:text-lg">
                {webinar.subheadline}
              </p>
            )}
            {webinar.body?.trim() ? (
              <p className="mt-2 max-w-lg font-[font1] text-sm leading-snug text-black/50">
                {webinar.body}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2.5">
              {webinar.startsAtIso ? (
                <WebinarLocalSchedule
                  startsAtIso={webinar.startsAtIso}
                  hasTime={webinar.startsAtHasTime}
                  userCountry={userCountry}
                />
              ) : null}
              <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                <Laptop className="h-4 w-4 text-terracotta" />
                Online
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                <Gift className="h-4 w-4 text-terracotta" />
                Gratis
              </span>
              {webinar.capacity ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                  <Users className="h-4 w-4 text-terracotta" />
                  Cupo para {webinar.capacity}
                </span>
              ) : null}
            </div>

            {/* El cupo es una expectativa, no un tope: el formulario nunca se
                cierra y todo el mundo recibe el enlace. Decirlo evita que
                alguien se vaya pensando que ya no queda sitio. */}
            {webinar.capacity ? (
              <p className="mt-3 font-[font1] text-xs text-black/45">
                La sala está pensada para {webinar.capacity} personas. Si se
                llena puedes registrarte igual: te enviamos el enlace de acceso
                a todas las que se inscriban.
              </p>
            ) : null}

            {/* Solo móvil: en desktop el formulario ya está a la derecha y
                este CTA duplica el submit del registro. */}
            <button
              type="button"
              onClick={scrollToRegistro}
              className="mt-7 inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-8 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c] lg:hidden"
            >
              {webinar.ctaLabel}
            </button>
            <p className="mt-3 font-[font1] text-xs text-black/40 lg:hidden">
              {BRAND.shortName} · sin costo
            </p>

            {webinar.videoStatus === "READY" && webinar.muxPlaybackId ? (
              <div className="mt-8 overflow-hidden rounded-2xl border border-black/8 bg-black shadow-[0_20px_50px_-28px_rgba(0,0,0,0.45)]">
                <WebinarMuxVideo
                  playbackId={webinar.muxPlaybackId}
                  title={webinar.headline}
                />
              </div>
            ) : null}
          </div>

          <div
            id="registro"
            className="relative scroll-mt-24 rounded-[1.5rem] border border-white/50 bg-white/55 p-5 shadow-[0_24px_60px_-28px_rgba(92,74,58,0.45)] backdrop-blur-xl lg:p-7"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
            />
            <h2 className="font-[font2] text-lg uppercase tracking-wide lg:text-xl">
              {webinar.formTitle}
            </h2>
            <div className="mt-5">
              <LeadCaptureForm
                userCountry={userCountry}
                fixedInterest={WEBINAR_INTEREST_LABEL}
                source="web_lead_form"
                sourceDetail={WEBINAR_INTEREST_LABEL}
                submitLabel={webinar.ctaLabel}
                variant="webinar"
              />
            </div>
          </div>
        </div>
      </section>

      {webinar.learnItems.length > 0 && (
        <section className="relative border-t border-black/8 px-5 py-12 lg:px-12 lg:py-14 xl:px-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-[font2] text-xl uppercase tracking-wide lg:text-2xl">
              {learnTitle}
            </h2>
            <ol className="mt-6 space-y-3">
              {webinar.learnItems.map((item, i) => (
                <li key={`${i}-${item}`} className="flex gap-3">
                  <span className="font-[font2] text-sm tracking-[0.12em] text-terracotta">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[font1] text-base leading-snug text-black/80">
                    {item}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {webinar.faq.length > 0 && (
        <section className="relative border-t border-black/8 px-5 py-12 lg:px-12 lg:py-14 xl:px-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-[font2] text-xl uppercase tracking-wide lg:text-2xl">
              Preguntas frecuentes
            </h2>
            <div className="mt-5">
              {webinar.faq.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="relative border-t border-black/8 px-5 py-10 lg:px-12 xl:px-20">
        <div className="mx-auto max-w-3xl text-center">
          <button
            type="button"
            onClick={scrollToRegistro}
            className="inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-8 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c]"
          >
            {webinar.ctaLabel}
          </button>
        </div>
      </section>
    </main>
  );
};

export default FreeWebinarPage;
