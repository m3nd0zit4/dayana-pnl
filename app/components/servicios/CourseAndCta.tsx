"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import type { Plan } from "../../../lib/plans";
import WhatsAppButton from "../ui/WhatsAppButton";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  coursePlan: Plan | null;
};

const CourseAndCta = ({ coursePlan }: Props) => {
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
    <section ref={rootRef} data-nav-color="black" className="bg-[#faf7f2] text-black">
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
              Plataforma de cursos online — próximamente
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
                <p className="font-[font1] text-sm mt-5 leading-snug text-white/75">
                  Valor e inscripción los coordinamos contigo por WhatsApp.
                </p>
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
              <div className="mt-6 w-full">
                <WhatsAppButton
                  message={coursePlan.whatsappMessage}
                  label="Inscribirme por WhatsApp"
                  size="lg"
                  className="w-full"
                />
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
            Hablemos antes
            <br />
            de decidir
          </h2>
          <p className="font-[font1] text-base lg:text-xl text-linen/80 mt-6 max-w-xl mx-auto cc-reveal">
            Escríbenos por WhatsApp y definimos juntas el paquete que mejor se
            ajusta a tu momento.
          </p>
          <div className="mt-10 flex justify-center cc-reveal">
            <WhatsAppButton
              message="Hola Dayana, estoy viendo los paquetes de terapia y me gustaría orientación para elegir."
              label="Escribir por WhatsApp"
              size="lg"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default CourseAndCta;
