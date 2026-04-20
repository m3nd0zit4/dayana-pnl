"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import SplitReveal from "../ui/SplitReveal";

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

      gsap.utils.toArray<HTMLElement>(".tt-card").forEach((el, i) => {
        gsap.from(el, {
          y: 80,
          opacity: 0,
          scale: 0.95,
          duration: 0.9,
          delay: i * 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
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
      className="bg-black text-white scroll-mt-20 px-3 lg:px-8 py-32 relative z-10"
    >
      <SplitReveal
        text={"Historias\nreales"}
        className="font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
      />

      <div className="tt-reveal lg:pl-[40%] mt-8 lg:mt-12 mb-16 p-3">
        <p className="font-[font1] lg:text-3xl text-lg leading-snug">
          Lo que pasa cuando alguien decide dejar atrás patrones viejos. Estos
          videos son el reflejo de procesos reales con DayanaPNL.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {testimonials.map((t) => (
          <div
            key={t.id}
            className="tt-card rounded-2xl overflow-hidden border border-white/15 bg-white/5 hover:border-[#D3FD50]/60 hover:bg-white/10 transition-colors"
          >
            <div className="aspect-video w-full bg-black/60 flex items-center justify-center">
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
                <div className="flex flex-col items-center gap-3 text-white/50">
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
            <div className="p-5">
              <div className="font-[font2] uppercase text-lg">{t.name}</div>
              <div className="font-[font1] text-sm text-white/70 mt-1">
                {t.excerpt}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default TestimonialsSection;
