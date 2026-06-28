"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import {
  formatCop,
  formatUsd,
  getTherapySavingsUsd,
  type Plan,
} from "../../../lib/plans";
import PlanCheckoutButtons from "../payments/PlanCheckoutButtons";
import SplitReveal from "../ui/SplitReveal";
import WhatsAppButton from "../ui/WhatsAppButton";
import { useStackingSection } from "../../hooks/useStackingSection";

gsap.registerPlugin(ScrollTrigger);

type PlanCardProps = {
  plan: Plan;
  variant?: "light" | "dark";
  userCountry?: string | null;
};

const PlanCard = ({ plan, variant = "light", userCountry }: PlanCardProps) => {
  const isDark = Boolean(variant === "dark" || plan.highlight);
  const isCourseWhatsAppOnly = plan.kind === "course";
  const isColombia = userCountry === "CO";
  const listPriceRef = useRef<HTMLSpanElement>(null);
  const base = isDark
    ? "bg-black text-white border-black"
    : "bg-white text-black border-black";

  const therapy = plan.kind === "therapy" ? plan.therapyPresentation : null;
  const savingsUsd = getTherapySavingsUsd(plan);
  const savingsCop =
    plan.listAmountCop != null && plan.amountCop != null
      ? plan.listAmountCop - plan.amountCop
      : null;
  const showTherapyPromo =
    therapy != null &&
    plan.listAmountUsd != null &&
    savingsUsd != null &&
    savingsUsd > 0;

  useEffect(() => {
    const el = listPriceRef.current;
    if (!showTherapyPromo || !el) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    gsap.killTweensOf(el);
    const tween = gsap.fromTo(
      el,
      {
        opacity: 0.68,
        scale: 1,
        filter: "brightness(1)",
      },
      {
        opacity: 1,
        scale: 1.05,
        filter: isDark
          ? "brightness(1.4) drop-shadow(0 0 18px rgba(255,255,255,0.22))"
          : "brightness(1.05) drop-shadow(0 0 14px rgba(225,90,90,0.28))",
        duration: 2.2,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        transformOrigin: "0% 50%",
      }
    );
    return () => {
      tween.kill();
      gsap.set(el, { clearProps: "opacity,scale,filter" });
    };
  }, [showTherapyPromo, isDark]);

  const dotClass = isDark ? "bg-linen" : "bg-black";
  const savingsClass = isDark ? "text-[#EBAEE0]" : "text-[#B328D4]";

  return (
    <div
      className={`sv-card border rounded-2xl p-6 flex flex-col justify-between h-full ${base} transition-[transform,box-shadow,border-color] duration-300 ease-out will-change-transform hover:-translate-y-1.5 hover:border-terracotta hover:shadow-[0_28px_64px_-22px_rgba(0,0,0,0.4)]`}
    >
      <div>
        {plan.tag && (
          <span className="inline-block font-[font2] uppercase text-[10px] tracking-wider bg-blush text-black px-2 py-1 rounded-full mb-3">
            {plan.tag}
          </span>
        )}
        <div className="font-[font2] uppercase text-[11px] tracking-wider opacity-60">
          {plan.title}
        </div>
        <div className="font-[font2] uppercase text-2xl lg:text-3xl mt-1 leading-tight">
          {plan.sessions}
        </div>

        {therapy ? (
          <div className="mt-5">
            {isColombia ? (
              /* ── Colombia: COP primary ── */
              <div className="space-y-1">
                {showTherapyPromo && plan.listAmountCop != null ? (
                  <>
                    <div
                      className={`font-[font2] text-[14px] font-bold uppercase tracking-[0.2em] ${
                        isDark ? "text-white" : "text-black/80"
                      }`}
                    >
                      Valor real
                    </div>
                    <span
                      ref={listPriceRef}
                      className="font-[font1] inline-block text-3xl lg:text-4xl font-semibold leading-tight line-through decoration-2 decoration-from-font text-[#FF0000] decoration-[#FF0000]/75"
                    >
                      {formatCop(plan.listAmountCop)} COP
                    </span>
                    <div
                      className={`font-[font2] text-[14px] uppercase font-bold tracking-[0.25em] pt-3 ${
                        isDark ? "text-blush" : "text-black/80"
                      }`}
                    >
                      Promoción especial
                    </div>
                  </>
                ) : null}
                {plan.amountCop != null ? (
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-[font1] text-4xl lg:text-[2.75rem] leading-none tracking-tight">
                      {formatCop(plan.amountCop)}
                    </span>
                    <span className="font-[font1] text-sm">COP</span>
                  </div>
                ) : null}
                <div
                  className={`font-[font1] text-[11px] ${
                    isDark ? "text-white/50" : "text-black/45"
                  }`}
                >
                  ≈ {formatUsd(plan.amountUsd)} USD
                </div>
                {showTherapyPromo && savingsCop != null ? (
                  <p
                    className={`font-[font1] text-[16px] font-medium tracking-wide pt-2.5 ${savingsClass}`}
                  >
                    Ahorras {formatCop(savingsCop)} COP
                  </p>
                ) : null}
              </div>
            ) : showTherapyPromo ? (
              /* ── International: USD promo ── */
              <div className="space-y-1">
                <div
                  className={`font-[font2] text-[14px] font-bold uppercase tracking-[0.2em] ${
                    isDark ? "text-white" : "text-black/80"
                  }`}
                >
                  Valor real
                </div>
                <span
                  ref={listPriceRef}
                  className="font-[font1] inline-block text-3xl lg:text-4xl font-semibold leading-tight line-through decoration-2 decoration-from-font text-[#FF0000] decoration-[#FF0000]/75"
                >
                  {formatUsd(plan.listAmountUsd!)} USD
                </span>
                <div
                  className={`font-[font2] text-[14px] uppercase font-bold tracking-[0.25em] pt-3 ${
                    isDark ? "text-blush" : "text-black/80"
                  }`}
                >
                  Promoción especial
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-[font1] text-4xl lg:text-[2.75rem] leading-none tracking-tight">
                    {formatUsd(plan.amountUsd)}
                  </span>
                  <span className="font-[font1] text-sm">USD</span>
                </div>
                <p
                  className={`font-[font1] text-[16px] font-medium tracking-wide pt-2.5 ${savingsClass}`}
                >
                  Ahorras {formatUsd(savingsUsd)} USD
                </p>
              </div>
            ) : (
              /* ── International: USD simple ── */
              <div className="flex items-baseline gap-2">
                <span className="font-[font1] text-4xl lg:text-5xl leading-none">
                  {formatUsd(plan.amountUsd)}
                </span>
                <span className="font-[font1] text-xs opacity-60">USD</span>
              </div>
            )}

            <p className="font-[font1] text-[15px] font-medium leading-snug mt-6">
              {therapy.sessionsHeadline}
            </p>
            <ul className="mt-3 space-y-1.5">
              {plan.features.map((line) => (
                <li
                  key={line}
                  className={`font-[font1] text-[12.5px] flex items-start gap-2 leading-snug ${
                    isDark ? "text-white/82" : "text-black/82"
                  }`}
                >
                  <span
                    className={`mt-1.5 inline-block w-1 h-1 rounded-full shrink-0 ${dotClass}`}
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {!isCourseWhatsAppOnly && (
              <div className="mt-5">
                {isColombia && plan.amountCop != null ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="font-[font1] text-4xl lg:text-5xl leading-none">
                        {formatCop(plan.amountCop)}
                      </span>
                      <span className="font-[font1] text-xs opacity-60">COP</span>
                    </div>
                    <div className={`font-[font1] text-[11px] mt-0.5 ${isDark ? "text-white/50" : "text-black/45"}`}>
                      ≈ {formatUsd(plan.amountUsd)} USD
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="font-[font1] text-4xl lg:text-5xl leading-none">
                        {formatUsd(plan.amountUsd)}
                      </span>
                      <span className="font-[font1] text-xs opacity-60">USD</span>
                    </div>
                    {plan.unitPrice && (
                      <div className="font-[font1] text-[11px] opacity-60 mt-0.5">
                        {plan.unitPrice}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {isCourseWhatsAppOnly && (
              <p
                className={`font-[font1] text-sm mt-5 leading-snug ${
                  isDark ? "text-white/75" : "text-black/70"
                }`}
              >
                Valor e inscripción los coordinamos contigo por WhatsApp.
              </p>
            )}
            <ul className="mt-5 space-y-2">
              {plan.features.map((f) => (
                <li
                  key={f}
                  className="font-[font1] text-sm flex items-start gap-2 leading-snug"
                >
                  <span
                    className={`mt-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {isCourseWhatsAppOnly ? (
        <div className="mt-6 w-full">
          <WhatsAppButton
            message={plan.whatsappMessage}
            label="Inscribirme por WhatsApp"
            size="lg"
            className="w-full"
          />
        </div>
      ) : (
        <PlanCheckoutButtons plan={plan} isDark={isDark} userCountry={userCountry} />
      )}
    </div>
  );
};

type ServicesSectionProps = {
  therapyPlans: Plan[];
  coursePlan: Plan | null;
  userCountry?: string | null;
};

const ServicesSection = ({ therapyPlans, coursePlan, userCountry }: ServicesSectionProps) => {
  const rootRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useStackingSection(rootRef, innerRef, { tilt: 4, isLast: true });

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

      // Heading parallax — the giant title drifts up slower than the scroll for depth.
      if (!reduce) {
        gsap.to(".sv-head", {
          yPercent: -14,
          ease: "none",
          scrollTrigger: {
            trigger: rootRef.current,
            start: "top bottom",
            end: "top top",
            scrub: true,
          },
        });
      }
    },
    { scope: rootRef }
  );

  return (
    <section
      ref={rootRef}
      id="servicios"
      data-nav-color="black"
      className="bg-[#faf7f2] text-black scroll-mt-20 relative z-10 rounded-t-[1.75rem] lg:rounded-t-[3.5rem] shadow-[0_-34px_80px_-24px_rgba(0,0,0,0.55)]"
    >
      <div
        ref={innerRef}
        className="will-change-transform origin-center"
      >
      <div className="px-3 lg:px-8 pt-32 pb-16">
        <SplitReveal
          text={"Lo que\nhacemos"}
          className="sv-head font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
        />
        <div className="sv-reveal lg:pl-[40%] lg:mt-16 mt-8 p-3">
          <p className="font-[font1] lg:text-4xl text-lg leading-tight lg:leading-snug">
            Con Dayana Beltrán acompañamos procesos reales de reprogramación
            neurolingüística. No vendemos motivación: trabajamos creencias limitantes,
            patrones y emociones negativas como colera, tristeza, miedo, dolor, culpa, ansiedad, traumas y fobias para que vuelvas a tomar el control de tu
            vida, tus relaciones y tu propósito.
          </p>
        </div>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12 sv-reveal">
          <h3 className="font-[font2] text-6xl lg:text-[8vw] uppercase leading-[0.9]">
            Terapias 1:1
          </h3>
          
          <h3 className="font-[font2] text-3xl lg:text-[4vw] uppercase leading-[0.9]">
            de Reprogramacion Neuronal 
          </h3>
          <p className="font-[font1] lg:max-w-md text-base lg:text-lg leading-snug">
            Sesiones privadas para transformar emociones negativas, creencias limitantes y patrones desde la raiz.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {therapyPlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} userCountry={userCountry} />
          ))}
        </div>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10 pb-28">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12 sv-reveal">
          <h3 className="font-[font2] text-6xl lg:text-[8vw] uppercase leading-[0.9]">
            Cursos en vivo
          </h3>
          <p className="font-[font1] lg:max-w-md text-base lg:text-lg leading-snug">
            Encuentros grupales en Google Meet. Cupo limitado para que cada
            participante tenga espacio real para transformar.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
          <div className="sv-card border border-black rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="font-[font2] uppercase text-[11px] tracking-wider text-black/60">
                Modalidad
              </div>
              <div className="font-[font2] uppercase text-3xl lg:text-4xl mt-2 leading-none">
                Google Meet
              </div>
            </div>
            <p className="font-[font1] text-base mt-6 text-black/70 leading-snug">
              En vivo, con interacción directa con Dayana.
            </p>
          </div>
          <div className="sv-card border border-black rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="font-[font2] uppercase text-[11px] tracking-wider text-black/60">
                Cupos
              </div>
              <div className="font-[font2] uppercase text-3xl lg:text-4xl mt-2 leading-none">
                30 máx.
              </div>
            </div>
            <p className="font-[font1] text-base mt-6 text-black/70 leading-snug">
              Espacio garantizado para cada participante.
            </p>
          </div>
          {coursePlan && <PlanCard plan={coursePlan} variant="dark" userCountry={userCountry} />}
        </div>
      </div>
      </div>
    </section>
  );
};

export default ServicesSection;
