"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import Link from "next/link";
import WhatsAppButton from "../ui/WhatsAppButton";

gsap.registerPlugin(ScrollTrigger);

const TerapiasCta = () => {
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
      id="cierre"
      data-nav-color="black"
      className="scroll-mt-20 bg-[#faf7f2] text-black"
    >
      {/* ── Los cursos viven en su propia página ── */}
      {/*
        Aquí había una tarjeta de precio de la mensualidad metida en una
        rejilla de tres celdas. Vendía dos cosas con lógicas de compra
        opuestas en la misma pantalla: un paquete que se paga una vez y una
        suscripción que se renueva. Ahora esta página vende una sola cosa y
        los cursos tienen `/cursos`, donde caben los ocho.
      */}
      <div className="border-t border-black/10 px-3 py-16 lg:px-8 lg:py-24">
        <div className="cc-reveal flex flex-col gap-8 rounded-2xl border border-black bg-white p-8 lg:flex-row lg:items-center lg:justify-between lg:p-12">
          <div className="lg:max-w-xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-terracotta">
              ¿Prefieres a tu ritmo?
            </p>
            <h2 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95] lg:text-5xl">
              La biblioteca de cursos
            </h2>
            <p className="mt-5 font-[font1] text-base leading-snug text-black/70 lg:text-lg">
              Fundamentos, creencias limitantes, hipnosis, niveles de
              conciencia, lenguaje, emociones y pareja. Una sola mensualidad
              los abre todos, con clases en vivo y grabaciones en el portal.
            </p>
          </div>
          <Link
            href="/cursos"
            className="inline-flex shrink-0 items-center gap-3 self-start rounded-full bg-black px-8 py-4 font-[font2] text-sm uppercase tracking-[0.15em] text-linen transition-all duration-300 hover:-translate-y-0.5 hover:bg-terracotta hover:text-white lg:self-auto"
          >
            Ver los cursos
            <span aria-hidden>→</span>
          </Link>
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
              href="/terapias/empezar?ref=terapias"
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

export default TerapiasCta;
