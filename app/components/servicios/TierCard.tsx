"use client";

import gsap from "gsap";
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  formatCop,
  formatUsd,
  getTherapySavingsUsd,
  type Plan,
} from "../../../lib/plans";
import PlanCheckoutButtons from "../payments/PlanCheckoutButtons";

type Props = {
  plan: Plan;
  userCountry?: string | null;
};

/**
 * Carta de paquete de terapia para /servicios. El protagonista es el número
 * de sesiones — la escalera 1→3→6→12→24 cuenta el recorrido.
 */
const TierCard = ({ plan, userCountry }: Props) => {
  const isDark = Boolean(plan.highlight);
  const isColombia = userCountry === "CO";
  const listPriceRef = useRef<HTMLSpanElement>(null);

  const savingsUsd = getTherapySavingsUsd(plan);
  const savingsCop =
    plan.listAmountCop != null && plan.amountCop != null
      ? plan.listAmountCop - plan.amountCop
      : null;
  const showPromo =
    plan.listAmountUsd != null && savingsUsd != null && savingsUsd > 0;

  const count = plan.sessionsCount ?? null;
  const perSessionUsd =
    count != null && count > 1 ? plan.amountUsd / count : null;
  const perSessionCop =
    count != null && count > 1 && plan.amountCop != null
      ? plan.amountCop / count
      : null;

  useEffect(() => {
    const el = listPriceRef.current;
    if (!showPromo || !el) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    gsap.killTweensOf(el);
    const tween = gsap.fromTo(
      el,
      { opacity: 0.68, scale: 1, filter: "brightness(1)" },
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
  }, [showPromo, isDark]);

  const base = isDark
    ? "bg-black text-white border-black ring-2 ring-terracotta xl:-translate-y-3"
    : "bg-white text-black border-black";
  const savingsClass = isDark ? "text-[#EBAEE0]" : "text-[#B328D4]";
  const checkClass = isDark ? "text-blush" : "text-terracotta";

  return (
    <div
      className={`sv-card relative border rounded-2xl p-6 pt-7 flex flex-col justify-between h-full ${base} transition-[transform,box-shadow,border-color] duration-300 ease-out will-change-transform hover:border-terracotta hover:shadow-[0_28px_64px_-22px_rgba(0,0,0,0.4)] ${
        isDark ? "" : "hover:-translate-y-1.5"
      }`}
    >
      {plan.tag && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-[font2] uppercase text-[10px] tracking-wider bg-blush text-black px-3 py-1 rounded-full shadow-sm">
          {plan.tag}
        </span>
      )}

      <div>
        <div className="font-[font2] uppercase text-[12px] tracking-[0.18em]">
          {plan.title}
        </div>

        {/* Escalera: el nº de sesiones es el héroe de la carta */}
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-[font2] text-6xl xl:text-7xl leading-[0.85] tracking-tight">
            {count ?? "—"}
          </span>
          <span
            className={`font-[font1] text-sm uppercase tracking-[0.2em] ${
              isDark ? "text-white/60" : "text-black/50"
            }`}
          >
            {count === 1 ? "sesión" : "sesiones"}
          </span>
        </div>

        {plan.therapyPresentation && (
          <p
            className={`font-[font1] text-[13px] leading-snug mt-2 ${
              isDark ? "text-white/70" : "text-black/60"
            }`}
          >
            {plan.therapyPresentation.sessionsHeadline}
          </p>
        )}

        <div className={`mt-5 pt-5 border-t ${isDark ? "border-white/15" : "border-black/10"}`}>
          {isColombia ? (
            <div className="space-y-1">
              {showPromo && plan.listAmountCop != null ? (
                <>
                  <div
                    className={`font-[font2] text-[12px] font-bold uppercase tracking-[0.2em] ${
                      isDark ? "text-white" : "text-black/80"
                    }`}
                  >
                    Valor real
                  </div>
                  <span
                    ref={listPriceRef}
                    className="font-[font1] inline-block text-2xl lg:text-3xl font-semibold leading-tight line-through decoration-2 decoration-from-font text-[#FF0000] decoration-[#FF0000]/75"
                  >
                    {formatCop(plan.listAmountCop)} COP
                  </span>
                  <div
                    className={`font-[font2] text-[12px] uppercase font-bold tracking-[0.25em] pt-2 ${
                      isDark ? "text-blush" : "text-black/80"
                    }`}
                  >
                    Promoción especial
                  </div>
                </>
              ) : null}
              {plan.amountCop != null ? (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-[font1] text-3xl lg:text-4xl leading-none tracking-tight">
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
              {perSessionCop != null && (
                <div
                  className={`font-mono text-[11px] pt-1 ${
                    isDark ? "text-white/60" : "text-black/55"
                  }`}
                >
                  ≈ {formatCop(perSessionCop)} por sesión
                </div>
              )}
              {showPromo && savingsCop != null ? (
                <p
                  className={`font-[font1] text-[15px] font-medium tracking-wide pt-2 ${savingsClass}`}
                >
                  Ahorras {formatCop(savingsCop)} COP
                </p>
              ) : null}
            </div>
          ) : showPromo ? (
            <div className="space-y-1">
              <div
                className={`font-[font2] text-[12px] font-bold uppercase tracking-[0.2em] ${
                  isDark ? "text-white" : "text-black/80"
                }`}
              >
                Valor real
              </div>
              <span
                ref={listPriceRef}
                className="font-[font1] inline-block text-2xl lg:text-3xl font-semibold leading-tight line-through decoration-2 decoration-from-font text-[#FF0000] decoration-[#FF0000]/75"
              >
                {formatUsd(plan.listAmountUsd!)} USD
              </span>
              <div
                className={`font-[font2] text-[12px] uppercase font-bold tracking-[0.25em] pt-2 ${
                  isDark ? "text-blush" : "text-black/80"
                }`}
              >
                Promoción especial
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-[font1] text-3xl lg:text-4xl leading-none tracking-tight">
                  {formatUsd(plan.amountUsd)}
                </span>
                <span className="font-[font1] text-sm">USD</span>
              </div>
              {perSessionUsd != null && (
                <div
                  className={`font-mono text-[11px] pt-1 ${
                    isDark ? "text-white/60" : "text-black/55"
                  }`}
                >
                  ≈ {formatUsd(perSessionUsd)} por sesión
                </div>
              )}
              <p
                className={`font-[font1] text-[15px] font-medium tracking-wide pt-2 ${savingsClass}`}
              >
                Ahorras {formatUsd(savingsUsd)} USD
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-[font1] text-3xl lg:text-4xl leading-none">
                  {formatUsd(plan.amountUsd)}
                </span>
                <span className="font-[font1] text-xs opacity-60">USD</span>
              </div>
              {perSessionUsd != null && (
                <div
                  className={`font-mono text-[11px] pt-1.5 ${
                    isDark ? "text-white/60" : "text-black/55"
                  }`}
                >
                  ≈ {formatUsd(perSessionUsd)} por sesión
                </div>
              )}
            </div>
          )}
        </div>

        <ul className="mt-4 space-y-1.5">
          {plan.features.map((line) => (
            <li
              key={line}
              className={`font-[font1] text-[12.5px] flex items-start gap-2 leading-snug ${
                isDark ? "text-white/82" : "text-black/82"
              }`}
            >
              <Check className={`mt-0.5 size-3.5 shrink-0 ${checkClass}`} strokeWidth={2.5} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <PlanCheckoutButtons plan={plan} isDark={isDark} userCountry={userCountry} />
    </div>
  );
};

export default TierCard;
