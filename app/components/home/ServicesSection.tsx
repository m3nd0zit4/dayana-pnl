"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";
import { buildWhatsAppUrl } from "../../../lib/contact";
import {
  COURSE_PLAN,
  THERAPY_PLANS,
  formatUsd,
  getTherapySavingsUsd,
  type Plan,
} from "../../../lib/plans";
import { usePayPalModal } from "../../context/PayPalModalContext";
import { useMercadoPagoCheckoutModal } from "../../context/MercadoPagoCheckoutModalContext";
import { PayPalBrandRow } from "../payments/PayPalBrandRow";
import { MercadoPagoBrandRow } from "../payments/MercadoPagoBrandRow";
import SplitReveal from "../ui/SplitReveal";
import { useStackingSection } from "../../hooks/useStackingSection";

gsap.registerPlugin(ScrollTrigger);

type PlanCardProps = {
  plan: Plan;
  variant?: "light" | "dark";
};

const PlanPaymentActions = ({
  plan,
  isDark,
}: {
  plan: Plan;
  isDark: boolean;
}) => {
  const { openPayPal } = usePayPalModal();
  const { openMercadoPago } = useMercadoPagoCheckoutModal();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const pulse = isDark ? "bg-white/10" : "bg-black/[0.06]";
  const payBusy = false;

  if (!ready) {
    return (
      <div className="mt-6 flex min-h-[130px] flex-col gap-2" aria-busy="true">
        <div className={`h-11 animate-pulse rounded-full ${pulse}`} />
        <div className={`h-11 animate-pulse rounded-full ${pulse}`} />
        <div className={`mx-auto h-3 w-36 animate-pulse rounded-full ${pulse}`} />
      </div>
    );
  }

  const mpFullClass = isDark
    ? "border-white/15 bg-white shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#00bcff] hover:bg-[#f4fbff]"
    : "border-[#b8e6f8] bg-gradient-to-b from-white via-[#f6fcff] to-[#e6f4fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(10,0,128,0.08)] hover:border-[#00bcff] hover:shadow-[0_10px_28px_rgba(10,0,128,0.12)]";

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      <button
        type="button"
        disabled={payBusy}
        onClick={() => openPayPal(plan.id)}
        className={`group flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2.5 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none ${
          isDark
            ? "border-white/15 bg-white text-[#003087] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#009cde] hover:bg-[#f4f9ff]"
            : "border-[#b8daf3] bg-gradient-to-b from-white via-[#f8fbff] to-[#e9f4fc] text-[#003087] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(0,48,135,0.08)] hover:border-[#009cde] hover:shadow-[0_10px_28px_rgba(0,48,135,0.12)]"
        }`}
      >
        <PayPalBrandRow
          tone="onLight"
          subtitle="Saldo o tarjeta"
          className="items-center"
        />
      </button>
      <button
        type="button"
        disabled={payBusy}
        onClick={() => openMercadoPago(plan.id)}
        className={`group flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2.5 transition-all cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${mpFullClass}`}
      >
        <MercadoPagoBrandRow
          tone="onLight"
          logoHeight={35}
          className="items-center"
        />
      </button>
      <a
        href={buildWhatsAppUrl(plan.whatsappMessage)}
        target="_blank"
        rel="noopener noreferrer"
        className={`w-full text-center font-[font1] text-[11px] uppercase tracking-[0.3em] py-1 transition-colors ${
          isDark
            ? "text-white/60 hover:text-linen"
            : "text-black/60 hover:text-black"
        }`}
      >
        Prefiero WhatsApp
      </a>
    </div>
  );
};

const PlanCard = ({ plan, variant = "light" }: PlanCardProps) => {
  const isDark = Boolean(variant === "dark" || plan.highlight);
  const listPriceRef = useRef<HTMLSpanElement>(null);
  const base = isDark
    ? "bg-black text-white border-black"
    : "bg-white text-black border-black";

  const therapy = plan.kind === "therapy" ? plan.therapyPresentation : null;
  const savingsUsd = getTherapySavingsUsd(plan);
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
      className={`sv-card border rounded-2xl p-6 flex flex-col justify-between h-full ${base} transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl`}
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
            {showTherapyPromo ? (
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
                  className={`font-[font1] inline-block text-3xl lg:text-4xl font-semibold leading-tight line-through decoration-2 decoration-from-font ${
                    isDark
                      ? "text-[#FF0000] decoration-[#FF0000]/75"
                      : "text-[#FF0000] decoration-[#FF0000]/75"
                  }`}
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
                  <span className="font-[font1] text-sm ">USD</span>
                </div>
                <p
                  className={`font-[font1] text-[16px] font-medium tracking-wide pt-2.5 ${savingsClass}`}
                >
                  Ahorras {formatUsd(savingsUsd)} USD
                </p>
              </div>
            ) : (
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
            <div className="mt-5 flex items-baseline gap-2">
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
      <PlanPaymentActions plan={plan} isDark={isDark} />
    </div>
  );
};

const ServicesSection = () => {
  const rootRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useStackingSection(rootRef, innerRef, { tilt: 4 });

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".sv-reveal").forEach((el) => {
        gsap.from(el, {
          y: 50,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });

      gsap.utils.toArray<HTMLElement>(".sv-card").forEach((el, i) => {
        const fromSide = i % 2 === 0 ? -60 : 60;
        gsap.from(el, {
          x: fromSide,
          y: 40,
          rotation: fromSide > 0 ? 2.5 : -2.5,
          opacity: 0,
          duration: 0.9,
          delay: (i % 3) * 0.08,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });
    },
    { scope: rootRef }
  );

  return (
    <section
      ref={rootRef}
      id="servicios"
      data-nav-color="black"
      className="bg-[#faf7f2] text-black scroll-mt-20 relative z-10"
    >
      <div
        ref={innerRef}
        className="will-change-transform origin-center"
      >
      <div className="px-3 lg:px-8 pt-32 pb-16">
        <SplitReveal
          text={"Lo que\nhacemos"}
          className="font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
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
          {THERAPY_PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
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
          <PlanCard plan={COURSE_PLAN} variant="dark" />
        </div>
      </div>
      </div>
    </section>
  );
};

export default ServicesSection;
