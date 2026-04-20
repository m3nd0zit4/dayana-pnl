"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { buildWhatsAppUrl } from "../../../lib/contact";
import SplitReveal from "../ui/SplitReveal";

gsap.registerPlugin(ScrollTrigger);

type Plan = {
  id: string;
  title: string;
  sessions: string;
  price: string;
  unitPrice?: string;
  tag?: string;
  highlight?: boolean;
  features: string[];
  message: string;
};

const therapyPlans: Plan[] = [
  {
    id: "t1",
    title: "Inicio",
    sessions: "1 Sesión",
    price: "$80",
    unitPrice: "por sesión",
    features: [
      "Videollamada 1:1",
      "Plan personalizado",
      "Seguimiento por WhatsApp",
    ],
    message:
      "Hola Dayana, me interesa el paquete de 1 sesión de terapia PNL ($80 USD).",
  },
  {
    id: "t3",
    title: "Exploración",
    sessions: "3 Sesiones",
    price: "$120",
    unitPrice: "$40 por sesión",
    features: [
      "3 encuentros 1:1",
      "Ahorro vs. sesión suelta",
      "Ejercicios entre sesiones",
    ],
    message:
      "Hola Dayana, me interesa el paquete de 3 sesiones de terapia PNL ($120 USD).",
  },
  {
    id: "t6",
    title: "Transformación",
    sessions: "6 Sesiones",
    price: "$240",
    unitPrice: "$40 por sesión",
    tag: "Más elegido",
    highlight: true,
    features: [
      "6 encuentros 1:1",
      "Cambios sostenidos",
      "Material de apoyo incluido",
    ],
    message:
      "Hola Dayana, me interesa el paquete de 6 sesiones de terapia PNL ($240 USD).",
  },
  {
    id: "t12",
    title: "Inmersión",
    sessions: "12 Sesiones",
    price: "$480",
    unitPrice: "$40 por sesión",
    features: [
      "12 encuentros 1:1",
      "Seguimiento extendido",
      "Ajuste de proceso personalizado",
    ],
    message:
      "Hola Dayana, me interesa el paquete de 12 sesiones de terapia PNL ($480 USD).",
  },
  {
    id: "t24",
    title: "Maestría",
    sessions: "24 Sesiones",
    price: "$900",
    unitPrice: "$37.5 por sesión",
    features: [
      "24 encuentros profundos",
      "Mejor ahorro por sesión",
      "Acompañamiento continuo",
    ],
    message:
      "Hola Dayana, me interesa el paquete de 24 sesiones de terapia PNL ($900 USD).",
  },
];

const coursePlan: Plan = {
  id: "curso",
  title: "Curso en vivo",
  sessions: "Inscripción",
  price: "$30",
  unitPrice: "por persona",
  features: [
    "Grupo en Google Meet",
    "Cupo máximo 30 personas",
    "Espacio real para compartir",
  ],
  message: "Hola Dayana, quiero inscribirme al próximo curso en vivo ($30 USD).",
};

type PlanCardProps = {
  plan: Plan;
  variant?: "light" | "dark";
};

const PlanCard = ({ plan, variant = "light" }: PlanCardProps) => {
  const isDark = variant === "dark" || plan.highlight;
  const base = isDark
    ? "bg-black text-white border-black"
    : "bg-white text-black border-black";

  return (
    <div
      className={`sv-card border rounded-2xl p-6 flex flex-col justify-between h-full ${base} transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl`}
    >
      <div>
        {plan.tag && (
          <span className="inline-block font-[font2] uppercase text-[10px] tracking-wider bg-[#D3FD50] text-black px-2 py-1 rounded-full mb-3">
            {plan.tag}
          </span>
        )}
        <div className="font-[font2] uppercase text-[11px] tracking-wider opacity-60">
          {plan.title}
        </div>
        <div className="font-[font2] uppercase text-2xl lg:text-3xl mt-1 leading-tight">
          {plan.sessions}
        </div>
        <div className="mt-5 flex items-baseline gap-2">
          <span className="font-[font1] text-4xl lg:text-5xl leading-none">
            {plan.price}
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
                className={`mt-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                  isDark ? "bg-[#D3FD50]" : "bg-black"
                }`}
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
      <a
        href={buildWhatsAppUrl(plan.message)}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-6 w-full text-center font-[font2] uppercase tracking-wide rounded-full py-3 text-sm transition-colors ${
          isDark
            ? "bg-[#D3FD50] text-black hover:bg-white"
            : "bg-black text-white hover:bg-[#25D366]"
        }`}
      >
        Compra
      </a>
    </div>
  );
};

const ServicesSection = () => {
  const rootRef = useRef<HTMLElement>(null);

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
      className="bg-white text-black scroll-mt-20 relative z-10"
    >
      <div className="px-3 lg:px-8 pt-32 pb-16">
        <SplitReveal
          text={"Lo que\nhacemos"}
          className="font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
        />
        <div className="sv-reveal lg:pl-[40%] lg:mt-16 mt-8 p-3">
          <p className="font-[font1] lg:text-4xl text-lg leading-tight lg:leading-snug">
            En DayanaPNL acompañamos procesos reales de reprogramación
            neurolingüística. No vendemos motivación: trabajamos creencias,
            patrones y emociones para que vuelvas a tomar el control de tu
            vida, tus relaciones y tu propósito.
          </p>
        </div>
      </div>

      <div className="px-3 lg:px-8 py-16 border-t border-black/10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12 sv-reveal">
          <h3 className="font-[font2] text-6xl lg:text-[8vw] uppercase leading-[0.9]">
            Terapias 1:1
          </h3>
          <p className="font-[font1] lg:max-w-md text-base lg:text-lg leading-snug">
            Paquetes de sesiones de PNL vía videollamada. Elige el ritmo que
            mejor se adapta a tu proceso.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {therapyPlans.map((plan) => (
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
          <PlanCard plan={coursePlan} variant="dark" />
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
