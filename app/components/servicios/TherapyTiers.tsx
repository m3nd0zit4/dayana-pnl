"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useRef, useState } from "react";
import type { Plan } from "../../../lib/plans";
import TierCard from "./TierCard";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  therapyPlans: Plan[];
  userCountry?: string | null;
};

/**
 * Los tres escalones que se muestran de entrada.
 *
 * Enseñar los cinco a la vez es una de las razones por las que esta página no
 * cierra: con cinco columnas y una tabla de nueve filas, la única variable
 * realmente comparable acaba siendo el precio por sesión, y la decisión se
 * aplaza. Tres opciones —una para probar, una recomendada, una a fondo— son un
 * rango; cinco son un catálogo. Los otros dos siguen a un clic para quien de
 * verdad los busca.
 */
const FEATURED_SESSION_COUNTS = [1, 6, 12];

const TherapyTiers = ({ therapyPlans, userCountry }: Props) => {
  const rootRef = useRef<HTMLElement>(null);
  const [showAll, setShowAll] = useState(false);

  const featured = therapyPlans.filter(
    (p) =>
      p.sessionsCount != null &&
      FEATURED_SESSION_COUNTS.includes(p.sessionsCount),
  );
  // Si el catálogo cambia de forma en el CRM y la selección se queda corta, se
  // muestran todos: un muro de opciones es mejor que una página con una sola
  // tarjeta.
  const hasFeaturedSubset =
    featured.length >= 2 && featured.length < therapyPlans.length;
  const visiblePlans = showAll || !hasFeaturedSubset ? therapyPlans : featured;

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".sv-reveal").forEach((el) => {
        gsap.from(el, {
          y: 56,
          opacity: 0,
          duration: 1,
          ease: "power4.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });

      gsap.utils.toArray<HTMLElement>(".sv-card").forEach((el, i) => {
        const fromSide = i % 2 === 0 ? -58 : 58;
        gsap.from(el, {
          x: fromSide,
          y: 54,
          scale: 0.92,
          rotation: fromSide > 0 ? 2.5 : -2.5,
          opacity: 0,
          duration: 1,
          delay: (i % 3) * 0.09,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
    },
    // Al revelar los cinco entran cartas nuevas al DOM; sin volver a correr
    // esto se quedarían sin su animación de entrada.
    { scope: rootRef, dependencies: [visiblePlans.length] },
  );

  return (
    <section
      ref={rootRef}
      id="terapias"
      data-nav-color="black"
      className="bg-[#faf7f2] text-black scroll-mt-20 relative rounded-t-[1.75rem] lg:rounded-t-[3.5rem]"
    >
      <div className="px-3 lg:px-8 py-16 lg:py-24">
        {/* La salida para quien llegó aquí sin saber qué necesita, que es la
            mayoría. Antes su única opción era escribir por WhatsApp, es decir,
            consumir una hora de Dayana antes de saber si iba a comprar. */}
        <Link
          href="/diagnostico?ref=servicios"
          className="sv-reveal mb-12 flex flex-col gap-4 rounded-2xl border border-terracotta/35 bg-terracotta/[0.07] px-5 py-5 transition-colors hover:border-terracotta/70 sm:flex-row sm:items-center sm:justify-between sm:gap-6 lg:px-8"
        >
          <span className="block">
            <span className="block font-[font2] text-sm uppercase tracking-[0.14em]">
              ¿No sabes cuál te corresponde?
            </span>
            <span className="mt-1.5 block font-[font1] text-base leading-snug text-black/65">
              Responde 8 preguntas y te decimos exactamente cuál y por qué.
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-black px-6 py-3 font-[font2] text-xs uppercase tracking-[0.15em] text-linen sm:self-auto">
            Diagnóstico gratis
            <span aria-hidden>→</span>
          </span>
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14 sv-reveal">
          <h2 className="font-[font2] text-5xl lg:text-[6vw] uppercase leading-[0.9]">
            Terapias 1:1
          </h2>
          <p className="font-[font1] lg:max-w-md text-base lg:text-lg leading-snug">
            Un mismo proceso, distintas profundidades. De una sesión puntual a
            un acompañamiento completo: creencias limitantes, emociones
            negativas y patrones, trabajados desde la raíz.
          </p>
        </div>

        <div
          className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:pt-4 ${
            visiblePlans.length > 3
              ? "lg:grid-cols-3 xl:grid-cols-5"
              : "lg:grid-cols-3"
          }`}
        >
          {visiblePlans.map((plan) => (
            <TierCard key={plan.id} plan={plan} userCountry={userCountry} />
          ))}
        </div>

        {hasFeaturedSubset && !showAll && (
          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/50 underline underline-offset-4 transition-colors hover:text-black"
            >
              Ver las {therapyPlans.length} opciones
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default TherapyTiers;
