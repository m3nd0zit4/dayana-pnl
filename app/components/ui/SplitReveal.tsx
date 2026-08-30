"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

gsap.registerPlugin(ScrollTrigger);

type Props = {
  text: string;
  className?: string;
  stagger?: number;
  duration?: number;
};

const SplitReveal = ({
  text,
  className = "",
  stagger = 0.04,
  duration = 0.9,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      const chars = ref.current.querySelectorAll<HTMLElement>(".sr-char");

      // Faltaba la guarda que el resto del sitio sí tiene, y aquí importa más
      // que en ninguna otra parte: esto anima **titulares**. Sin ella, quien
      // pide menos movimiento recibía cada carácter del título barriendo hacia
      // arriba.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(chars, { clearProps: "all" });
        return;
      }

      gsap.from(chars, {
        yPercent: 110,
        opacity: 0,
        duration,
        stagger,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ref.current,
          start: "top 88%",
        },
      });
    },
    { scope: ref }
  );

  const lines = text.split("\n");

  return (
    <div ref={ref} className={className}>
      {lines.map((line, li) => (
        <span key={li} className="block overflow-hidden whitespace-nowrap">
          {Array.from(line).map((char, ci) => (
            <span key={ci} className="sr-char inline-block">
              {char === " " ? "\u00A0" : char}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
};

export default SplitReveal;
