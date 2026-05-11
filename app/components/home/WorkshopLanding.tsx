"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { WORKSHOP_VIRTUAL_PLAN } from "../../../lib/plans";
import WhatsAppButton from "../ui/WhatsAppButton";

gsap.registerPlugin(ScrollTrigger);

const focusTopics = [
  "Metodologías de herramientas coaching en desarrollo personal",
  "Despertar de conciencia",
  "Introspección profunda",
  "Identificación de creencias limitantes y bloqueos",
  "Metodologías y estructuras coaching para crear metas, proyectos y objetivos",
  "Definición clara de metas y enfoque",
  "Ley de causa y efecto",
  "Reprogramación de creencias limitantes y bloqueos",
  "Corte de lasos energeticos",
  "Programación de futuro",
  "Listos a tomar acción",
];

const daySchedule = [
  {
    time: "7:30 a.m. – 8:00 a.m.",
    title: "Apertura y bienvenida",
  },
  {
    time: "8:00 a.m. – 9:00 a.m.",
    title: "Despertar de conciencia + introspección",
  },
  {
    time: "9:00 a.m. – 10:00 a.m.",
    title: "Creencias limitantes",
  },
  {
    time: "10:00 a.m. – 11:00 a.m.",
    title: "Metodologías y estructuras para metas, proyectos y objetivos",
  },
  {
    time: "11:00 a.m. – 12:00 p.m.",
    title: "Definición clara de metas y enfoque personal",
  },
  {
    time: "12:00 p.m. – 12:30 p.m.",
    title: "Ley de causa y efecto",
  },
  {
    time: "12:30 p.m. – 1:10 p.m.",
    title: "Almuerzo (40 minutos)",
  },
  {
    time: "1:10 p.m. – 1:20 p.m.",
    title: "Tiempo de espera breve para reinicio del grupo",
  },
  {
    time: "1:20 p.m. – 3:30 p.m.",
    title:
      "Reprogramación de eventos emocionales y creencias limitantes + corte de losos energeticos (trabajo profundo grupal)",
  },
  {
    time: "3:30 p.m. – 4:30 p.m.",
    title: "Programación de futuro para tomar acción y cierre",
  },
];

const WorkshopLanding = () => {
  const rootRef = useRef<HTMLElement>(null);
  const heroTitleRef = useRef<HTMLDivElement>(null);

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
        <div className="wk-reveal">
          <span className="inline-flex items-center rounded-full border border-black/15 px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em]">
            Taller virtual
          </span>
        </div>

        <div
          ref={heroTitleRef}
          className="mt-7 font-[font2] text-[15vw] md:text-[11vw] lg:text-[8.8vw] uppercase leading-[0.86]"
        >
          {(["Saca tu", "mejor", "versión"] as const).map((line, i) => (
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
          Un espacio de transformación, conciencia y acción para entender tu
          mente, reprogramar patrones y alinear tu vida con lo que realmente
          quieres.
        </p>

        <div className="wk-reveal mt-10 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-black/15 bg-white p-6">
            <div className="font-[font2] text-[10px] uppercase tracking-[0.25em] text-black/60">
              Fecha
            </div>
            <div className="font-[font1] text-2xl lg:text-3xl mt-2 leading-none">
              Sábado 16 de mayo
            </div>
          </div>
          <div className="rounded-2xl border border-black/15 bg-white p-6">
            <div className="font-[font2] text-[10px] uppercase tracking-[0.25em] text-black/60">
              Horario
            </div>
            <div className="font-[font1] text-2xl lg:text-3xl mt-2 leading-none">
              7:30 a.m. – 4:30 p.m.
            </div>
          </div>
          <div className="rounded-2xl border border-black/15 bg-black text-white p-6">
            <div className="font-[font2] text-[10px] uppercase tracking-[0.25em] text-white/60">
              Inicio puntual
            </div>
            <div className="font-[font1] text-2xl lg:text-3xl mt-2 leading-none">
              8:00 a.m.
            </div>
            <p className="font-[font1] text-sm mt-3 text-white/75 leading-snug">
              7:30 a.m. a 8:00 a.m. apertura y bienvenida.
            </p>
          </div>
        </div>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 wk-reveal">
            <h2 className="font-[font2] text-5xl lg:text-[5.2vw] uppercase leading-[0.9]">
              Qué vamos a trabajar
            </h2>
            <p className="font-[font1] mt-4 text-black/70 leading-snug text-base lg:text-lg">
              Contenido práctico para generar claridad mental, enfoque y cambios
              sostenibles.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {focusTopics.map((topic) => (
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
            <h2 className="font-[font2] text-5xl lg:text-[5.2vw] uppercase leading-[0.9]">
              Estructura del día
            </h2>
            <p className="font-[font1] text-black/70 max-w-lg leading-snug">
              Jornada virtual intensiva, de apertura a cierre, con bloques de
              trabajo guiado y aplicación práctica en tiempo real.
            </p>
          </div>

          <div className="space-y-2">
            {daySchedule.map((slot) => (
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
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
          <aside className="wk-reveal lg:col-span-7 rounded-3xl border border-black/10 bg-black text-white p-7 lg:p-10">
            <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
              Inscripción
            </div>
            <p className="font-[font1] mt-4 text-white/82 leading-snug max-w-2xl text-lg lg:text-2xl">
              Reserva tu cupo directamente por WhatsApp. Te guiamos en todo el
              proceso y confirmamos tu inscripción de inmediato.
            </p>
          </aside>

          <div className="wk-reveal lg:col-span-5 rounded-3xl border border-black/10 bg-white p-7 lg:p-8">
            <h3 className="font-[font2] text-2xl lg:text-3xl uppercase leading-none">
              Reserva tu cupo
            </h3>
            <p className="font-[font1] text-sm text-black/65 leading-snug mt-4">
              Escríbenos por WhatsApp y te compartimos el paso a paso para
              asegurar tu lugar en el taller.
            </p>
            <WhatsAppButton
              message={WORKSHOP_VIRTUAL_PLAN.whatsappMessage}
              label="Reservar por WhatsApp"
              size="lg"
              className="mt-6 w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default WorkshopLanding;
