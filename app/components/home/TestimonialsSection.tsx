"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";
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
    name: "Nury",
    excerpt:
      "A través de estas terapias he aprendido a priorizarme y a encontrar una seguridad que no tenía. Me siento mucho más tranquila; ha sido un cambio profundo y favorable para mi bienestar personal.",
    youtubeId: "KHlVFKENIFw",
  },
  {
    id: 2,
    name: "Teresa",
    excerpt:
      "Estaba pasando por un momento muy difícil en mi vida y no encontraba la salida. Gracias a las herramientas de Dayana, hoy me siento renovada, con una paz interior increíble y la fuerza para seguir adelante con alegría.",
    youtubeId: "LnumJ4E208Y",
  },
  {
    id: 3,
    name: "Luz",
    excerpt:
      "Llegué en un momento de crisis emocional, pero gracias al proceso con Dayana, hoy tengo una visión clara, enfoque y, sobre todo, una armonía que me permite tomar mejores decisiones para mi vida.",
    youtubeId: "uUqnsYrpXck",
  },
  {
    id: 4,
    name: "Glenda",
    excerpt:
      "He logrado identificar y reprogramar esas ideas limitantes y traumas del pasado que no me dejaban avanzar. Pasé de estar en modo supervivencia a vivir con libertad, consciencia y la valentía necesaria para alcanzar mis metas.",
    youtubeId: "ccWpOuvL90I",
  },
];

const TestimonialVideo = ({
  youtubeId,
  name,
}: {
  youtubeId: string | null;
  name: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isIframeLoading, setIsIframeLoading] = useState(false);
  const [shouldMountPlayer, setShouldMountPlayer] = useState(false);

  useEffect(() => {
    if (!youtubeId || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        setShouldMountPlayer(true);
        observer.disconnect();
      },
      { root: null, rootMargin: "220px 0px", threshold: 0.01 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [youtubeId]);

  useEffect(() => {
    if (!shouldMountPlayer) return;
    setIsIframeLoading(true);
  }, [shouldMountPlayer]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full bg-black/50 flex items-center justify-center"
    >
      {youtubeId ? (
        shouldMountPlayer ? (
          <>
            <iframe
              className="w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`}
              title={name}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              onLoad={() => setIsIframeLoading(false)}
            />
            {isIframeLoading ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 pointer-events-none">
                <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/50 px-4 py-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span className="font-[font1] text-[10px] uppercase tracking-[0.22em] text-white/85">
                    Cargando video
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShouldMountPlayer(true)}
            className="relative h-full w-full overflow-hidden"
            aria-label={`Activar video de ${name}`}
          >
            <img
              src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
              alt={`Miniatura de ${name}`}
              className="h-full w-full object-cover opacity-80"
              loading="lazy"
            />
            <span className="absolute inset-0 z-10 flex items-center justify-center bg-black/25">
              <span className="inline-flex h-12 w-[72px] items-center justify-center rounded-xl bg-[#FF0000] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6 text-white"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        )
      ) : null}
    </div>
  );
};

const TestimonialsSection = () => {
  const rootRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useStackingSection(rootRef, innerRef, {
    tilt: -5,
    tiltScrubEnd: "top 8%",
  });

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
        gsap.from(card, {
          y: 80,
          opacity: 0,
          duration: 1.0,
          delay: i * 0.14,
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
            "radial-gradient(60% 40% at 15% 20%, rgba(236,227,212,0.14), transparent 60%)",
            "radial-gradient(50% 45% at 85% 75%, rgba(237,195,177,0.16), transparent 65%)",
            "radial-gradient(70% 50% at 50% 110%, rgba(212,184,150,0.10), transparent 70%)",
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
        className="relative px-3 lg:px-8 pt-36 pb-24 lg:pt-44 lg:pb-32 will-change-transform origin-center"
      >
        <SplitReveal
          text={"Historias\nreales"}
          className="font-[font2] text-[16vw] lg:text-[12vw] uppercase leading-[0.85]"
        />

        <div className="tt-reveal lg:pl-[40%] mt-8 lg:mt-12 mb-20 lg:mb-24 p-3">
          <p className="font-[font1] lg:text-3xl text-lg leading-snug">
            Lo que pasa cuando alguien decide dejar atrás patrones viejos. Estos
            videos son el reflejo de procesos reales con Dayana Beltrán.
          </p>
        </div>

        <div ref={gridRef} className="space-y-14 lg:space-y-20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
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
                      "radial-gradient(60% 80% at 50% 0%, rgba(237,195,177,0.20), transparent 70%)",
                  }}
                />
                <TestimonialVideo
                  youtubeId={t.youtubeId}
                  name={t.name}
                />
                <div className="relative p-5">
                  <div className="font-[font2] uppercase text-lg">{t.name}</div>
                  <p className="font-[font1] text-sm text-white/75 mt-2 leading-relaxed">
                    {t.excerpt}
                  </p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
