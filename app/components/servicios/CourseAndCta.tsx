"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Suspense, useRef } from "react";
import Link from "next/link";
import { formatCop, formatUsd, type Plan } from "../../../lib/plans";
import WhatsAppButton from "../ui/WhatsAppButton";
import PortalCheckoutCta from "../payments/PortalCheckoutCta";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  coursePlan: Plan | null;
  isColombia: boolean;
  userCountry?: string | null;
  /** Habilita el botón de Google en el registro previo al pago. */
  googleEnabled?: boolean;
};

const CourseAndCta = ({
  coursePlan,
  isColombia,
  userCountry,
  googleEnabled = false,
}: Props) => {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".cc-reveal").forEach((el) => {
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

  return (
    <section
      ref={rootRef}
      id="curso"
      data-nav-color="black"
      className="scroll-mt-20 bg-[#faf7f2] text-black"
    >
      {/* ── Curso en vivo ── */}
      <div className="px-3 lg:px-8 py-16 lg:py-24 border-t border-black/10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12 cc-reveal">
          <h2 className="font-[font2] text-5xl lg:text-[6vw] uppercase leading-[0.9]">
            Cursos en vivo
          </h2>
          <div className="lg:max-w-md">
            <p className="font-[font1] text-base lg:text-lg leading-snug">
              Encuentros grupales en Google Meet. Cupo limitado para que cada
              participante tenga espacio real para transformar.
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-black/45 mt-3">
              Incluye portal de miembros: clases en vivo, grabaciones y módulos ·{" "}
              <Link href="/acceso" className="underline underline-offset-4 hover:text-black">
                ya soy miembro
              </Link>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
          <div className="cc-reveal border border-black rounded-2xl p-8 flex flex-col justify-between bg-white">
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
          <div className="cc-reveal border border-black rounded-2xl p-8 flex flex-col justify-between bg-white">
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
          {coursePlan && (
            <div className="cc-reveal border border-black rounded-2xl p-8 flex flex-col justify-between bg-black text-white">
              <div>
                <div className="font-[font2] uppercase text-[11px] tracking-wider opacity-60">
                  {coursePlan.title}
                </div>
                <div className="font-[font2] uppercase text-3xl lg:text-4xl mt-2 leading-tight">
                  {coursePlan.sessions}
                </div>
                {/* Precio por región — mismo criterio automático que las terapias */}
                {isColombia && coursePlan.amountCop != null ? (
                  <div className="mt-4">
                    <div className="font-[font1] text-3xl leading-none">
                      {formatCop(coursePlan.amountCop)}{" "}
                      <span className="font-[font2] uppercase text-xs tracking-[0.25em] text-white/55">
                        COP{coursePlan.unitPrice ? ` ${coursePlan.unitPrice}` : ""}
                      </span>
                    </div>
                    <div className="font-[font1] text-sm mt-1.5 text-white/70">
                      ≈ {formatUsd(coursePlan.amountUsd)} USD
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="font-[font1] text-3xl leading-none">
                      {formatUsd(coursePlan.amountUsd)}{" "}
                      <span className="font-[font2] uppercase text-xs tracking-[0.25em] text-white/55">
                        USD{coursePlan.unitPrice ? ` ${coursePlan.unitPrice}` : ""}
                      </span>
                    </div>
                  </div>
                )}
                <ul className="mt-5 space-y-2">
                  {coursePlan.features.map((f) => (
                    <li
                      key={f}
                      className="font-[font1] text-sm flex items-start gap-2 leading-snug"
                    >
                      <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-linen" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="w-full">
                {/*
                  La mensualidad abre el portal —clases, grabaciones, módulos—,
                  así que la cuenta tiene que existir ANTES de pagar. Sin ella
                  se paga y no se entra a ninguna parte: queda la matrícula sin
                  nadie a quien asociarla. Mismo camino que los talleres.
                */}
                <Suspense fallback={<div className="h-[60px]" aria-hidden />}>
                  <PortalCheckoutCta
                    plan={coursePlan}
                    isDark
                    userCountry={userCountry}
                    googleEnabled={googleEnabled}
                    autopayReturnPath="/servicios"
                  />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CTA final ── */}
      <div className="bg-ink text-linen rounded-t-[1.75rem] lg:rounded-t-[3.5rem]">
        <div className="px-3 lg:px-8 py-20 lg:py-28 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-blush mb-6 cc-reveal">
            ¿Aún con dudas?
          </p>
          <h2 className="font-[font2] text-5xl lg:text-[7vw] uppercase leading-[0.9] cc-reveal">
            Que no lo
            <br />
            decida el precio
          </h2>
          <p className="font-[font1] text-base lg:text-xl text-linen/80 mt-6 max-w-xl mx-auto cc-reveal">
            Ocho preguntas y sabrás qué patrón te está frenando y qué proceso te
            corresponde. Dos minutos, sin costo y sin hablar con nadie.
          </p>
          {/* El CTA final ya no manda a WhatsApp. Era el último eslabón del
              circuito viejo —catálogo → duda → conversación manual— y era
              justamente el que había que romper. WhatsApp se queda debajo,
              como segunda opción para quien de verdad prefiere hablar. */}
          <div className="mt-10 flex flex-col items-center gap-6 cc-reveal">
            <Link
              href="/diagnostico?ref=servicios"
              className="inline-flex items-center gap-3 rounded-full bg-linen px-9 py-4 font-[font2] text-sm uppercase tracking-[0.15em] text-ink transition-transform duration-300 hover:-translate-y-0.5"
            >
              Hacer mi diagnóstico gratis
              <span aria-hidden>→</span>
            </Link>
            <WhatsAppButton
              message="Hola Dayana, estoy viendo los paquetes de terapia y me gustaría orientación para elegir."
              label="Prefiero hablar por WhatsApp"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default CourseAndCta;
