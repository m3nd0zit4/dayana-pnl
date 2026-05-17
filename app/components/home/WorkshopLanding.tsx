"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useRef } from "react";
import {
  getWorkshopStatusLabel,
  type Workshop,
} from "../../../lib/workshops";
import WhatsAppButton from "../ui/WhatsAppButton";

gsap.registerPlugin(ScrollTrigger);

type WorkshopLandingProps = {
  workshop: Workshop;
};

const WorkshopLanding = ({ workshop }: WorkshopLandingProps) => {
  const rootRef = useRef<HTMLElement>(null);
  const heroTitleRef = useRef<HTMLDivElement>(null);
  const statusLabel = getWorkshopStatusLabel(workshop.status);
  const isCompleted = workshop.status === "completed";

  useGSAP(
    () => {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      const heroRoot = heroTitleRef.current;
      const heroLines = heroRoot?.querySelectorAll<HTMLElement>(
        ".wk-hero-line-inner"
      );
      if (heroRoot && heroLines && heroLines.length === 3) {
        if (prefersReducedMotion) {
          gsap.set(heroLines, { opacity: 1, yPercent: 0 });
        } else {
          gsap.from(heroLines, {
            yPercent: 110,
            opacity: 0,
            duration: 0.85,
            stagger: 0.07,
            ease: "power3.out",
            scrollTrigger: {
              trigger: heroRoot,
              start: "top 88%",
            },
          });
        }
      }

      gsap.utils.toArray<HTMLElement>(".wk-reveal").forEach((el, i) => {
        gsap.from(el, {
          y: 40,
          opacity: 0,
          duration: 0.85,
          delay: i * 0.04,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });

      gsap.utils.toArray<HTMLElement>(".wk-topic").forEach((el, i) => {
        gsap.from(el, {
          y: 18,
          opacity: 0,
          duration: 0.55,
          delay: i * 0.035,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
        });
      });
    },
    { scope: rootRef }
  );

  return (
    <section ref={rootRef} className="bg-[#faf7f2] text-black min-h-screen">
      <div className="px-3 lg:px-8 pt-24 lg:pt-28 pb-16 max-w-[1400px] mx-auto">
        <Link
          href="/taller-virtual"
          className="wk-reveal inline-flex items-center gap-2 font-[font2] text-[10px] uppercase tracking-[0.25em] text-black/55 transition-colors hover:text-black"
        >
          <span aria-hidden>←</span>
          Todos los talleres
        </Link>

        <div className="wk-reveal mt-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-black/15 px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em]">
            Taller virtual
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em] ${
              isCompleted
                ? "border-black/20 bg-black text-white"
                : "border-black/15 bg-white text-black/80"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        <div
          ref={heroTitleRef}
          className="mt-7 font-[font2] text-[15vw] md:text-[11vw] lg:text-[8.8vw] uppercase leading-[0.86]"
        >
          {workshop.heroLines.map((line, i) => (
            <span key={line} className="block overflow-hidden">
              <span
                className={`wk-hero-line-inner inline-block ${
                  i === 2 ? "whitespace-nowrap" : ""
                }`}
              >
                {line}
              </span>
            </span>
          ))}
        </div>

        <p className="wk-reveal mt-7 font-[font1] text-lg lg:text-2xl leading-snug max-w-4xl text-black/80">
          {workshop.intro}
        </p>

        <article className="wk-reveal mt-10 rounded-3xl border border-black/15 bg-white p-7 lg:p-10 shadow-[0_24px_60px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-black/55">
                {workshop.editionLabel}
              </div>
              <h2 className="font-[font2] mt-2 text-3xl lg:text-5xl uppercase leading-[0.92]">
                {workshop.title}
              </h2>
              <p className="font-[font1] mt-4 max-w-2xl text-base lg:text-lg leading-snug text-black/72">
                {workshop.detailSummary}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 rounded-2xl border border-black/12 bg-[#faf7f2] px-5 py-4 lg:min-w-[220px]">
              <span className="inline-flex items-center gap-2 font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/60">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isCompleted ? "bg-emerald-600" : "bg-amber-500"
                  }`}
                  aria-hidden
                />
                {statusLabel}
              </span>
              <div className="font-[font1] text-xl lg:text-2xl leading-tight">
                {workshop.dateLabel}
              </div>
              <div className="font-[font1] text-sm text-black/60">
                {workshop.scheduleLabel}
              </div>
            </div>
          </div>
        </article>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 gap-10 xl:grid-cols-12 xl:gap-12">
          <div className="min-w-0 wk-reveal xl:col-span-4">
            <h2 className="font-[font2] text-4xl sm:text-5xl lg:text-6xl uppercase leading-[0.92] break-words">
              {workshop.topicsSectionTitle}
            </h2>
            <p className="font-[font1] mt-4 max-w-md text-black/70 leading-snug text-base lg:text-lg">
              {workshop.topicsSectionDescription}
            </p>
          </div>
          <div className="min-w-0 xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {workshop.focusTopics.map((topic) => (
              <div
                key={topic}
                className="wk-topic rounded-2xl border border-black/10 bg-white px-4 py-4 font-[font1] text-sm lg:text-base leading-snug"
              >
                {topic}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10">
        <div className="max-w-[1400px] mx-auto">
          <div className="wk-reveal flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
            <h2 className="font-[font2] text-4xl sm:text-5xl lg:text-6xl uppercase leading-[0.92] shrink-0">
              Estructura del día
            </h2>
            <p className="font-[font1] text-black/70 max-w-lg leading-snug">
              {workshop.scheduleSectionDescription}
            </p>
          </div>

          <div className="space-y-2">
            {workshop.daySchedule.map((slot) => (
              <article
                key={`${slot.time}-${slot.title}`}
                className="wk-reveal rounded-2xl border border-black/10 bg-white px-4 py-4 lg:px-6 lg:py-5 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-2 lg:gap-6"
              >
                <div className="font-[font2] text-xs uppercase tracking-[0.2em] text-black/55">
                  {slot.time}
                </div>
                <p className="font-[font1] text-sm lg:text-base leading-snug">
                  {slot.title}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10 pb-24">
        <div className="max-w-[1400px] mx-auto">
          <article className="wk-reveal rounded-3xl border border-black/10 bg-black text-white p-7 lg:p-10">
            <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
              {isCompleted ? "Próximas ediciones" : "Inscripción"}
            </div>
            <p className="font-[font1] mt-4 text-white/82 leading-snug max-w-2xl text-lg lg:text-2xl">
              {isCompleted
                ? "Las inscripciones para esta fecha ya cerraron. Si quieres enterarte de la siguiente edición del taller o empezar un proceso ahora, escríbenos por WhatsApp o revisa terapias y cursos en vivo."
                : "Escríbenos por WhatsApp para reservar tu cupo o resolver dudas sobre esta edición."}
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <WhatsAppButton
                message={workshop.whatsappMessage}
                label="Consultar por WhatsApp"
                size="lg"
                className="sm:flex-1"
              />
              <Link
                href="/#servicios"
                className="inline-flex items-center justify-center rounded-full border border-white/35 bg-white/10 px-6 py-3 font-[font2] text-xs uppercase tracking-[0.2em] text-white transition-colors hover:bg-white/20 sm:flex-1"
              >
                Ver servicios
              </Link>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};

export default WorkshopLanding;
