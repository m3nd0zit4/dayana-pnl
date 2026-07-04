"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import type { Plan } from "../../../lib/plans";
import TierCard from "./TierCard";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  therapyPlans: Plan[];
  userCountry?: string | null;
};

const TherapyTiers = ({ therapyPlans, userCountry }: Props) => {
  const rootRef = useRef<HTMLElement>(null);

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
    { scope: rootRef }
  );

  return (
    <section
      ref={rootRef}
      id="terapias"
      data-nav-color="black"
      className="bg-[#faf7f2] text-black scroll-mt-20 relative rounded-t-[1.75rem] lg:rounded-t-[3.5rem]"
    >
      <div className="px-3 lg:px-8 py-16 lg:py-24">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14 sv-reveal">
          <h2 className="font-[font2] text-5xl lg:text-[6vw] uppercase leading-[0.9]">
            Terapias 1:1
          </h2>
          <p className="font-[font1] lg:max-w-md text-base lg:text-lg leading-snug">
            Un mismo proceso, cinco profundidades. De una sesión puntual a un
            acompañamiento completo: creencias limitantes, emociones negativas
            y patrones, trabajados desde la raíz.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 xl:pt-4">
          {therapyPlans.map((plan) => (
            <TierCard key={plan.id} plan={plan} userCountry={userCountry} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default TherapyTiers;
