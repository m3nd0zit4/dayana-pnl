"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { initFluidReveal } from "../../../lib/hero/fluidReveal";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const DESKTOP_MQ = "(min-width: 768px)";

/**
 * Single hero sequence — HeroFluid + HeroMasthead merged into one storytelling beat.
 *
 * 1. Load: Dayana's centred portrait with the WebGL fluid breathing behind it, and
 *    the one action of the page — «Agenda tu llamada gratis» — at the bottom.
 * 2. Scroll: the masked "DB" rises in from below, settles centre-frame, then shrinks
 *    and travels to the header centre while the scene deepens to ink.
 * 3. Hand-off: the deepened hero bridges seamlessly into the next section
 *    («Cómo funciona», `CallSteps`), which reveals as the logo reaches its
 *    docked position.
 */
const Hero = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deepenRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLAnchorElement>(null);

  // ── WebGL fluid reveal (fine-pointer only). Touch / reduced-motion keep the
  //    static centred portrait as a full fallback. ──
  useEffect(() => {
    const pin = pinRef.current;
    const canvas = canvasRef.current;
    if (!pin || !canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse =
      window.matchMedia("(pointer: coarse)").matches ||
      !window.matchMedia("(hover: hover)").matches;
    if (reduce || coarse) return;

    // Art-directed crop per breakpoint (original framing).
    const isDesktop = window.matchMedia(DESKTOP_MQ).matches;
    const prefix = isDesktop ? "/hero/hero-desktop" : "/hero/hero-mobile";
    // Hover gallery — different poses revealed by the liquid, faces anchored.
    const seq = [1, 2, 3, 4].map((i) => `${prefix}-rev-${i}.webp`);

    const destroy = initFluidReveal(canvas, pin, {
      baseSrc: `${prefix}.webp`,
      seqSrcs: seq,
      onReady: () => {
        canvas.style.opacity = "1";
      },
    });
    return destroy;
  }, []);

  // ── One master scroll timeline ties the whole sequence together. ──
  useGSAP(
    () => {
      if (!sectionRef.current) return;
      const mm = gsap.matchMedia();

      mm.add(
        {
          isDesktop: "(min-width: 768px)",
          isMobile: "(max-width: 767px)",
          reduce: "(prefers-reduced-motion: reduce)",
        },
        (ctx) => {
          const { isDesktop, reduce } = ctx.conditions as {
            isDesktop: boolean;
            isMobile: boolean;
            reduce: boolean;
          };

          // Shared start state — logo waits just below the viewport.
          gsap.set(markRef.current, { autoAlpha: 0, yPercent: 120, scale: 1.5 });
          gsap.set(dockRef.current, { autoAlpha: 0 });
          gsap.set(deepenRef.current, { opacity: 0 });

          // Reduced motion → no scrub: rest on the portrait + docked mark.
          if (reduce) {
            gsap.set(markRef.current, { autoAlpha: 0 });
            gsap.set(dockRef.current, { autoAlpha: 1 });
            gsap.set(cueRef.current, { autoAlpha: 0 });
            return;
          }

          // One pinned cinematic timeline for every breakpoint — only the pin
          // length differs (shorter travel on phones). Pinning is what lets the
          // DB rise, fill the frame, and dock cleanly at the header centre;
          // Lenis (SmoothScroll) normalises touch so the pin stays smooth.
          const end = isDesktop ? "+=160%" : "+=130%";
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: sectionRef.current,
              start: "top top",
              end,
              pin: pinRef.current,
              scrub: 1,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
          });

          tl
            // cue clears as the journey begins
            .to(cueRef.current, { autoAlpha: 0, duration: 0.1 }, 0)
            // slow push-in on the fluid for depth
            .fromTo(stageRef.current, { scale: 1 }, { scale: 1.07, ease: "none", duration: 1 }, 0)
            // the masked DB rises in from below and settles centre-frame
            .to(markRef.current, { autoAlpha: 1, yPercent: 0, scale: 1, ease: "power2.out", duration: 0.42 }, 0.05)
            // darken behind the letters so the DB-mask reads — capped, never a void
            .to(deepenRef.current, { opacity: 0.58, ease: "power1.inOut", duration: 0.48 }, 0.12)
            // logo travels up to the header centre
            .to(markRef.current, { yPercent: -46, scale: 0.06, ease: "power2.inOut", duration: 0.34 }, 0.6)
            // final hand-off: settle the deepen + crossfade into the crisp docked mark
            .to(deepenRef.current, { opacity: 0.72, ease: "power1.in", duration: 0.22 }, 0.74)
            .to(markRef.current, { autoAlpha: 0, duration: 0.1 }, 0.95)
            .to(dockRef.current, { autoAlpha: 1, ease: "power2.out", duration: 0.16 }, 0.92);
        }
      );
    },
    { scope: sectionRef }
  );

  return (
    <section ref={sectionRef} id="hero" data-nav-color="white" className="hero" aria-label="Dayana Beltrán">
      <div ref={pinRef} className="hero-pin">
        {/* Fluid stage — centred portrait (LCP + non-GL fallback) + WebGL canvas */}
        <div ref={stageRef} className="hero-stage-fluid">
          <div className="hero-photo-wrap">
            <picture>
              <source
                media={DESKTOP_MQ}
                type="image/avif"
                srcSet="/hero/hero-desktop.avif 1500w, /hero/hero-desktop-2200.avif 2200w"
                sizes="100vw"
              />
              <source
                media={DESKTOP_MQ}
                type="image/webp"
                srcSet="/hero/hero-desktop.webp 1500w, /hero/hero-desktop-2200.webp 2200w"
                sizes="100vw"
              />
              <source
                type="image/avif"
                srcSet="/hero/hero-mobile.avif 900w, /hero/hero-mobile-1320.avif 1320w"
                sizes="100vw"
              />
              <source
                type="image/webp"
                srcSet="/hero/hero-mobile.webp 900w, /hero/hero-mobile-1320.webp 1320w"
                sizes="100vw"
              />
              <img
                id="hero-photo"
                src="/hero/hero-mobile.jpg"
                alt="Dayana Beltrán, reprogramadora neuronal y coach en PNL"
                width={900}
                height={1146}
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          </div>
          <canvas ref={canvasRef} id="hero-gl" />
        </div>

        {/* Static premium vignette (load state) */}
        <div className="hero-vignette" aria-hidden="true" />

        {/* Scroll-driven deepen — darkens the scene into the form hand-off */}
        <div ref={deepenRef} className="hero-deepen" />

        {/* Logo mask — Dayana's portrait through the "DB" letterforms */}
        <div ref={markRef} className="hero-mark" aria-hidden="true">
          DB
        </div>

        {/* La acción de la portada: agendar la llamada gratis.

            No entra en la línea de tiempo del scroll a propósito: no tiene
            tween propio ni comparte `cueRef` (con movimiento reducido el cue se
            oculta, y el botón no puede desaparecer con él). Vive dentro de
            `hero-pin`, así que se queda fijo con la escena y sale con ella.

            Capas de `hero-pin`: escenario 0 · viñeta 2 · oscurecido 3 · máscara
            «DB» 6 (ocupa todo el cuadro, y sin `pointer-events: none`). Por eso
            va en z-7: por encima de la máscara cuando sube, para que no lo
            tape ni se quede con el toque. El contenedor no recibe punteros
            (el fluido sigue leyendo el cursor en toda la franja); solo el
            enlace. Abajo y centrado: la máscara asentada ocupa el centro del
            cuadro y el cue de scroll, la esquina derecha (en móvil no se ve).
            En móvil sube a 4.5rem para quedar por encima del botón flotante
            de WhatsApp, que aparece abajo a la derecha al final de la escena. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(4.5rem,env(safe-area-inset-bottom))] z-[7] flex flex-col items-center gap-3 px-5 text-center md:bottom-14">
          <Link
            href="/llamada?ref=inicio"
            className="pointer-events-auto inline-flex max-w-full items-center justify-center rounded-full bg-terracotta px-6 py-4 font-[font2] text-[11px] uppercase tracking-[0.16em] text-white transition-colors duration-300 hover:bg-linen hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink sm:px-9 sm:text-xs sm:tracking-[0.2em]"
          >
            Agenda tu llamada gratis
          </Link>
          <p className="font-[font1] text-sm leading-snug text-white/85">
            Gratis · Dayana te llama por WhatsApp
          </p>
        </div>

        {/* Scroll cue — lleva a «Cómo funciona», la sección que sigue. */}
        <a ref={cueRef} href="#como-funciona" className="scroll-hint" aria-label="Desplázate para explorar">
          <span>Scroll</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </a>
      </div>

      {/* Docked header mark — persists after the intro */}
      <div ref={dockRef} className="hero-dock" aria-hidden="true">
        DB<span className="hero-dock-dot">.</span>
      </div>
    </section>
  );
};

export default Hero;
