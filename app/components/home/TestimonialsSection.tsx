"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, useState } from "react";
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
    name: "Teresa",
    excerpt:
      "Estaba pasando por un momento muy difícil en mi vida y no encontraba la salida. Gracias a las herramientas de Dayana, hoy me siento renovada, con una paz interior increíble y la fuerza para seguir adelante con alegría.",
    youtubeId: "LnumJ4E208Y",
  },
  {
    id: 2,
    name: "Luz",
    excerpt:
      "Llegué en un momento de crisis emocional, pero gracias al proceso con Dayana, hoy tengo una visión clara, enfoque y, sobre todo, una armonía que me permite tomar mejores decisiones para mi vida.",
    youtubeId: "uUqnsYrpXck",
  },
  {
    id: 3,
    name: "Glenda",
    excerpt:
      "He logrado identificar y reprogramar esas ideas limitantes y traumas del pasado que no me dejaban avanzar. Pasé de estar en modo supervivencia a vivir con libertad, consciencia y la valentía necesaria para alcanzar mis metas.",
    youtubeId: "ccWpOuvL90I",
  },
  {
    id: 4,
    name: "Nury",
    excerpt:
      "A través de estas terapias he aprendido a priorizarme y a encontrar una seguridad que no tenía. Me siento mucho más tranquila; ha sido un cambio profundo y favorable para mi bienestar personal.",
    youtubeId: "KHlVFKENIFw",
  },
];

const TestimonialVideo = ({
  youtubeId,
  name,
}: {
  youtubeId: string | null;
  name: string;
}) => {
  const [isIframeLoading, setIsIframeLoading] = useState(false);
  /** Solo tras clic: evita cargar iframes de YouTube hasta que la persona lo pida. */
  const [playRequested, setPlayRequested] = useState(false);

  const handlePlayClick = () => {
    setPlayRequested(true);
    setIsIframeLoading(true);
  };

  const embedSrc =
    playRequested && youtubeId
      ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`
      : undefined;

  return (
    <div className="relative aspect-video w-full bg-white/[0.04] flex items-center justify-center">
      {youtubeId ? (
        playRequested ? (
          <>
            <iframe
              className="w-full h-full"
              src={embedSrc}
              title={`Video de ${name}`}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              onLoad={() => setIsIframeLoading(false)}
            />
            {isIframeLoading ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[2px] pointer-events-none">
                <div className="flex items-center gap-3 rounded-full border border-white/25 bg-white/15 px-5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-md">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                  <span className="font-[font1] text-xs font-medium tracking-wide text-white">
                    Cargando…
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={handlePlayClick}
            className="relative h-full w-full cursor-pointer overflow-hidden"
            aria-label={`Reproducir video de ${name} en YouTube`}
          >
            <img
              src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
              alt={`Miniatura de ${name}`}
              className="h-full w-full object-cover opacity-90"
              loading="lazy"
            />
            <span className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-t from-black/35 via-black/10 to-transparent">
              <span className="inline-flex items-center gap-2.5 rounded-full border border-white/30 bg-gradient-to-b from-white/28 to-white/[0.12] px-5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5 shrink-0 text-white drop-shadow-sm"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="font-[font1] text-sm font-medium tracking-wide text-white drop-shadow-sm">
                  Ver video
                </span>
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
            Lo que pasa cuando alguien decide invertir en reprogramar su mente, se eliminan las creencias limitantes y sus vidas empizan a cambiar. Estos
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
