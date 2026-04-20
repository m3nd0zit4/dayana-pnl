"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import SplitReveal from "../ui/SplitReveal";
import { useStackingSection } from "../../hooks/useStackingSection";

gsap.registerPlugin(ScrollTrigger);

type Testimonial = {
  id: number;
  name: string;
  excerpt: string;
  youtubeId: string | null;
};

const testimonials: Testimonial[] = [
  {
    id: 1,
    name: "Próximamente",
    excerpt: "Espacio para tu historia.",
    youtubeId: null,
  },
  {
    id: 2,
    name: "Próximamente",
    excerpt: "Espacio para tu historia.",
    youtubeId: null,
  },
  {
    id: 3,
    name: "Próximamente",
    excerpt: "Espacio para tu historia.",
    youtubeId: null,
  },
];

const TestimonialsSection = () => {
  const rootRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useStackingSection(rootRef, innerRef, { tilt: -5 });

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".tt-reveal").forEach((el) => {
        gsap.from(el, {
          y: 50,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });

      if (!gridRef.current) return;
      const cards = gsap.utils.toArray<HTMLElement>(
        gridRef.current.querySelectorAll(".tt-card")
      );

      cards.forEach((card, i) => {
        const total = cards.length;
        const mid = (total - 1) / 2;
        const dir = i < mid ? -1 : i > mid ? 1 : 0;
        const fromX = dir === 0 ? 0 : dir * 180;
        const fromY = dir === 0 ? 120 : 40;
        const rot = dir === 0 ? 0 : dir * -6;

        gsap.from(card, {
          x: fromX,
          y: fromY,
          rotation: rot,
          opacity: 0,
          duration: 1.1,
          delay: i * 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: gridRef.current,
            start: "top 85%",
            once: true,
          },
        });
      });
    },
    { scope: rootRef }
  );

  return (
    <section
      ref={rootRef}
      id="testimonios"
      data-nav-color="white"
      className="bg-black text-white scroll-mt-20 relative z-10 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-80"
        style={{
          background: [
            "radial-gradient(60% 40% at 15% 20%, rgba(224,213,198,0.12), transparent 60%)",
            "radial-gradient(50% 45% at 85% 75%, rgba(168,92,62,0.18), transparent 65%)",
            "radial-gradient(70% 50% at 50% 110%, rgba(224,213,198,0.08), transparent 70%)",
          ].join(","),
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-[0.08]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }}
      />

      <div
        ref={innerRef}
        className="relative px-3 lg:px-8 py-32 will-change-transform origin-center"
      >
        <SplitReveal
          text={"Historias\nreales"}
          className="font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
        />

        <div className="tt-reveal lg:pl-[40%] mt-8 lg:mt-12 mb-16 p-3">
          <p className="font-[font1] lg:text-3xl text-lg leading-snug">
            Lo que pasa cuando alguien decide dejar atrás patrones viejos. Estos
            videos son el reflejo de procesos reales con Dayana Beltrán.
          </p>
        </div>

        <div
          ref={gridRef}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6"
        >
          {testimonials.map((t) => (
            <div
              key={t.id}
              className="tt-card group relative rounded-2xl overflow-hidden border border-linen/15 bg-gradient-to-br from-linen/[0.06] via-white/[0.02] to-transparent backdrop-blur-[2px] hover:border-linen/50 hover:from-linen/[0.12] transition-colors will-change-transform"
            >
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(60% 80% at 50% 0%, rgba(224,213,198,0.18), transparent 70%)",
                }}
              />
              <div className="relative aspect-video w-full bg-black/50 flex items-center justify-center">
                {t.youtubeId ? (
                  <iframe
                    className="w-full h-full"
                    src={`https://www.youtube-nocookie.com/embed/${t.youtubeId}`}
                    title={t.name}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-linen/60">
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-12 h-12"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span className="font-[font1] text-sm uppercase tracking-wider">
                      Video próximo
                    </span>
                  </div>
                )}
              </div>
              <div className="relative p-5">
                <div className="font-[font2] uppercase text-lg">{t.name}</div>
                <div className="font-[font1] text-sm text-white/70 mt-1">
                  {t.excerpt}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
