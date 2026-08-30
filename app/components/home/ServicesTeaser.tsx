"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useRef } from "react";
import { formatCop, formatUsd } from "../../../lib/plans";
import SplitReveal from "../ui/SplitReveal";
import { useStackingSection } from "../../hooks/useStackingSection";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  fromUsd: number | null;
  fromCop: number | null;
  isColombia: boolean;
  courseUsd: number | null;
  courseCop: number | null;
};

/**
 * Banda CTA que reemplaza a la antigua sección de servicios en la landing.
 * Mantiene el contrato de apilado (id, shell redondeado, useStackingSection
 * isLast) del que depende el pin de TestimonialsSection.
 */
const ServicesTeaser = ({
  fromUsd,
  fromCop,
  isColombia,
  courseUsd,
  courseCop,
}: Props) => {
  const rootRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useStackingSection(rootRef, innerRef, { tilt: 4, isLast: true });

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".st-reveal").forEach((el) => {
        gsap.from(el, {
          y: 56,
          opacity: 0,
          duration: 1,
          ease: "power4.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
    },
    { scope: rootRef }
  );

  const fromLabel = isColombia
    ? fromCop != null
      ? `Desde ${formatCop(fromCop)} COP`
      : null
    : fromUsd != null
      ? `Desde ${formatUsd(fromUsd)} USD`
      : null;

  const courseLabel = isColombia
    ? courseCop != null
      ? `${formatCop(courseCop)} COP`
      : null
    : courseUsd != null
      ? `${formatUsd(courseUsd)} USD`
      : null;

  return (
    <section
      ref={rootRef}
      id="servicios"
      data-nav-color="black"
      className="bg-[#faf7f2] text-black scroll-mt-20 relative z-10 rounded-t-[1.75rem] lg:rounded-t-[3.5rem] shadow-[0_-34px_80px_-24px_rgba(0,0,0,0.55)]"
    >
      <div ref={innerRef} className="will-change-transform origin-center">
        <div className="px-3 lg:px-8 pt-28 pb-24 lg:pt-36 lg:pb-32">
          <SplitReveal
            text={"Terapias\n& cursos"}
            className="font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
          />
          <div className="lg:pl-[40%] mt-8 lg:mt-14 st-reveal">
            <p className="font-[font1] text-lg lg:text-3xl leading-snug">
              Paquetes de 1 a 24 sesiones de reprogramación neurolingüística,
              1:1 en vivo por Google Meet. Elige la profundidad de tu proceso.
            </p>
            {fromLabel && (
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-black/50 mt-6">
                {fromLabel} · sesión única
              </p>
            )}
            {courseLabel && (
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-black/50 mt-2">
                Curso en vivo {courseLabel} / mes
              </p>
            )}
            {/* Dos destinos, porque son dos productos: un paquete que se
                paga una vez y una mensualidad que se renueva. Mandarlos a la
                misma página es lo que hacía /servicios. */}
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href="/terapias/empezar"
                className="inline-flex items-center gap-3 rounded-full bg-black text-linen font-[font2] uppercase text-sm tracking-[0.15em] px-8 py-4 transition-transform duration-300 hover:-translate-y-0.5 hover:bg-terracotta hover:text-white"
              >
                Terapias 1:1
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/cursos"
                className="inline-flex items-center gap-3 rounded-full border border-black font-[font2] uppercase text-sm tracking-[0.15em] px-8 py-4 transition-colors duration-300 hover:bg-black hover:text-linen"
              >
                Cursos
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ServicesTeaser;
