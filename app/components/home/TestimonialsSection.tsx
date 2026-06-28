"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useRef, useState } from "react";

gsap.registerPlugin(ScrollTrigger, SplitText);

type Testimonial = {
  id: number;
  name: string;
  excerpt: string;
  youtubeId: string;
};

const testimonials: Testimonial[] = [
  {
    id: 1,
    name: "Teresa",
    excerpt:
      "Estaba pasando por un momento muy difícil y no encontraba la salida. Gracias a las herramientas de Dayana, hoy me siento renovada, con una paz interior increíble y la fuerza para seguir adelante.",
    youtubeId: "LnumJ4E208Y",
  },
  {
    id: 2,
    name: "Luz",
    excerpt:
      "Llegué en un momento de crisis emocional, pero gracias al proceso con Dayana hoy tengo una visión clara, enfoque y, sobre todo, una armonía que me permite tomar mejores decisiones para mi vida.",
    youtubeId: "uUqnsYrpXck",
  },
  {
    id: 3,
    name: "Glenda",
    excerpt:
      "He logrado identificar y reprogramar esas ideas limitantes y traumas del pasado que no me dejaban avanzar. Pasé de estar en modo supervivencia a vivir con libertad, consciencia y valentía.",
    youtubeId: "ccWpOuvL90I",
  },
  {
    id: 4,
    name: "Nury",
    excerpt:
      "A través de estas terapias aprendí a priorizarme y a encontrar una seguridad que no tenía. Me siento mucho más tranquila; ha sido un cambio profundo y favorable para mi bienestar personal.",
    youtubeId: "KHlVFKENIFw",
  },
];

// One tile per person (no repeats), in a tight 2×2 cluster that sits right
// above the panel. z = depth/parallax speed.
const TILES = [
  { top: "4vh", left: "9%", width: "34%", mLeft: "7%", mWidth: "62%", z: 200 },
  { top: "10vh", left: "55%", width: "35%", mLeft: "40%", mWidth: "58%", z: -340 },
  { top: "46vh", left: "13%", width: "34%", mLeft: "8%", mWidth: "60%", z: 110 },
  { top: "50vh", left: "54%", width: "35%", mLeft: "40%", mWidth: "58%", z: -460 },
].map((t, i) => ({ ...t, t: testimonials[i] }));

function embedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  if (typeof window !== "undefined") params.set("origin", window.location.origin);
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

// Controlled tile — playback is owned by the parent so only ONE video can be
// mounted/playing at a time (clicking another swaps the single iframe).
const Tile = ({
  t,
  uid,
  playing,
  onPlay,
}: {
  t: Testimonial;
  uid: string;
  playing: boolean;
  onPlay: (uid: string) => void;
}) => (
  <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-white/[0.04]">
    {playing ? (
      <iframe
        src={embedUrl(t.youtubeId)}
        title={`Video de ${t.name}`}
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    ) : (
      <button
        type="button"
        onClick={() => onPlay(uid)}
        className="group absolute inset-0 h-full w-full cursor-pointer"
        aria-label={`Reproducir video de ${t.name}`}
      >
        <img
          src={`https://i.ytimg.com/vi/${t.youtubeId}/hqdefault.jpg`}
          alt={`Testimonio de ${t.name}`}
          className="h-full w-full object-cover grayscale-[0.35] transition-all duration-700 ease-out group-hover:grayscale-0"
          loading="lazy"
          decoding="async"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/40 to-transparent">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/15 px-4 py-2 backdrop-blur-md">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-white"><path d="M8 5v14l11-7z" /></svg>
            <span className="font-[font2] text-[11px] uppercase tracking-[0.18em] text-white">{t.name}</span>
          </span>
        </span>
      </button>
    )}
  </div>
);

const TestimonialsSection = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinWrapRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  // Single source of truth for playback → one video at a time.
  const [playingUid, setPlayingUid] = useState<string | null>(null);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      // Mobile uses a static stacked layout (below); the scroll animation is
      // desktop-only. Reduced-motion rests on the first testimonial.
      if (!desktop || reduce || !pinWrapRef.current || !targetRef.current) {
        // Static fallback: panel fully open, poster hidden, first testimonial shown.
        if (targetRef.current)
          gsap.set(targetRef.current, { clipPath: "inset(0% 0% 0% 0% round 0px)" });
        gsap.set(".tt-cover", { autoAlpha: 0 });
        gsap.set(".tt-overlay", { autoAlpha: 1 });
        gsap.set(".tt-desc", { autoAlpha: (i: number) => (i === 0 ? 1 : 0) });
        gsap.set(".tt-vid", { autoAlpha: (i: number) => (i === 0 ? 1 : 0) });
        return;
      }

      const dim = "rgba(255,255,255,0.28)";
      const bright = "rgba(255,255,255,1)";
      const duration = 0.8;
      const pause = 0.5;
      const stagger = 0.05;

      const headingX = (i: number) => {
        const items = gsap.utils.toArray<HTMLElement>(".tt-name");
        return items[i] ? -items[i].offsetLeft : 0;
      };

      const splits = testimonials.map((_, idx) =>
        SplitText.create(`.tt-desc-${idx}`, { type: "lines", mask: "lines", linesClass: "tt-line" })
      );
      splits.forEach((s) => gsap.set(s.lines, { yPercent: 110 }));
      gsap.set(".tt-name", { color: dim });
      gsap.set(".tt-name-0", { color: bright });
      gsap.set(".tt-heading", { transformOrigin: "0% 50%", force3D: true });
      gsap.set(".tt-vid", { autoAlpha: 0 });
      gsap.set(".tt-vid-0", { autoAlpha: 1 });

      gsap.utils.toArray<HTMLElement>(".tt-tile").forEach((el) => {
        gsap.to(el, {
          yPercent: parseFloat(el.dataset.speed ?? "0") * 50,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        });
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: pinWrapRef.current,
          start: "center center",
          end: "+=400%",
          scrub: 0.55,
          // No ScrollTrigger pin: holding the panel via position:fixed reflows the
          // absolutely-positioned wrapper (large CLS). Instead the timeline below
          // translates it (transform = no layout shift) over the same scrub.
          invalidateOnRefresh: true,
        },
      });

      // Expand via clip-path (paint-only) instead of width/height (layout) so the
      // scroll-linked growth never triggers layout shift (CLS) under Lenis.
      // Driven by a single proxy value so all four insets move in lockstep —
      // GSAP's native clip-path string tween interpolates them unevenly.
      const clip = { p: 0 };
      const applyClip = () => {
        const v = 1 - clip.p;
        gsap.set(targetRef.current, {
          clipPath: `inset(${28 * v}% ${39 * v}% ${28 * v}% ${39 * v}% round ${18 * v}px)`,
        });
      };
      applyClip();

      tl.to(clip, { p: 1, ease: "none", duration: 1, onUpdate: applyClip }, 0)
        .to(".tt-center", { autoAlpha: 0, duration: 1 }, "<")
        .to(".tt-cover", { autoAlpha: 0, ease: "none", duration: 0.8 }, "<")
        .to(".tt-overlay", { autoAlpha: 1, duration: 0.2 })
        .to(splits[0].lines, { yPercent: 0, stagger, duration, ease: "none" })
        .to({}, { duration: pause });

      for (let s = 0; s < testimonials.length - 1; s++) {
        const next = s + 1;
        const label = `s${next}`;
        tl.addLabel(label);
        tl.to(".tt-heading", { x: () => headingX(next), duration, ease: "power1.inOut" }, label)
          .to(splits[s].lines, { yPercent: -110, stagger, duration, ease: "none" }, label)
          .to(`.tt-name-${s}`, { color: dim, duration }, label)
          .to(`.tt-name-${next}`, { color: bright, duration }, label)
          .to(`.tt-vid-${s}`, { autoAlpha: 0, duration }, label)
          .to(`.tt-vid-${next}`, { autoAlpha: 1, duration }, label)
          .to(splits[next].lines, { yPercent: 0, stagger, duration, ease: "none" }, label)
          .to({}, { duration: pause });
      }

      // Hold the panel in view by translating it (transform → no CLS) exactly as
      // far as the page scrolls over the timeline. Spans the whole timeline at
      // position 0 so it stays in lockstep with the scrub.
      tl.to(
        pinWrapRef.current,
        { y: () => window.innerHeight * 4, ease: "none", duration: tl.duration() },
        0
      );

      return () => splits.forEach((s) => s.revert());
    },
    { scope: containerRef }
  );

  return (
    <section
      ref={containerRef}
      id="testimonios"
      data-nav-color="white"
      className="relative z-10 bg-black text-white"
    >
      {/* MOBILE — clean stacked list (the scroll animation is desktop-only) */}
      <div className="px-5 pt-24 pb-20 lg:hidden">
        <span className="block font-[font2] text-[11px] uppercase tracking-[0.42em] text-terracotta">
          Testimonios
        </span>
        <h2 className="mt-4 font-[font2] text-[15vw] uppercase leading-[0.85]">
          Historias<br />reales
        </h2>
        <div className="mt-12 flex flex-col gap-12">
          {testimonials.map((t, idx) => (
            <div key={t.id}>
              <Tile t={t} uid={`m${idx}`} playing={playingUid === `m${idx}`} onPlay={setPlayingUid} />
              <div className="mt-5 flex items-baseline gap-4">
                <span className="font-[font2] text-xs tracking-[0.2em] text-terracotta">0{idx + 1}</span>
                <h3 className="font-[font2] text-2xl uppercase">{t.name}</h3>
              </div>
              <p className="mt-3 font-[font1] leading-relaxed text-white/70">“{t.excerpt}”</p>
            </div>
          ))}
        </div>
      </div>

      {/* DESKTOP — the cinematic scatter → expand → cycle */}
      <div className="hidden h-[580vh] w-full overflow-x-clip lg:block">
        {/* Sticky title — fades as the panel expands */}
      <div className="tt-center pointer-events-none sticky top-0 left-0 z-[5] flex h-screen w-full flex-col items-center justify-center px-6 text-center">
        <span className="font-[font2] text-[11px] uppercase tracking-[0.42em] text-terracotta">
          Testimonios
        </span>
        <h2 className="mt-4 font-[font2] text-[15vw] uppercase leading-[0.85] lg:text-[12vw]">
          Historias<br />reales
        </h2>
      </div>

      {/* Scattered video field */}
      <div className="absolute inset-0 h-full w-full">
        {TILES.map((tile, i) => (
          <div
            key={i}
            data-speed={tile.z / 500}
            className="tt-tile absolute top-(--top) left-(--m-left) w-(--m-width) shadow-[0_1vw_3vw_rgba(0,0,0,0.45)] lg:left-(--left) lg:w-(--width)"
            style={
              {
                "--top": tile.top,
                "--left": tile.left,
                "--width": tile.width,
                "--m-left": tile.mLeft,
                "--m-width": tile.mWidth,
                transform: `perspective(1200px) translateZ(${tile.z}px)`,
              } as React.CSSProperties
            }
          >
            <Tile t={tile.t} uid={`s${i}`} playing={playingUid === `s${i}`} onPlay={setPlayingUid} />
          </div>
        ))}
      </div>

      {/* Pinned expanding solid panel */}
      <div
        ref={pinWrapRef}
        className="pointer-events-none absolute left-0 z-[8] flex h-screen w-full items-center justify-start overflow-hidden"
        style={{ top: "80vh" }}
      >
        <div
          ref={targetRef}
          className="pointer-events-auto absolute inset-0 h-full w-full overflow-hidden bg-terracotta will-change-[clip-path]"
          style={{ clipPath: "inset(28% 39% 28% 39% round 18px)" }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: "radial-gradient(120% 100% at 80% 10%, rgba(255,255,255,0.16), transparent 55%)" }}
          />

          {/* Collapsed-state cover — a B&W duotone portrait that turns the panel
              into a deliberate "poster". Positioned to fill the clipped window
              (matches the clip-path inset). Cross-dissolves out as it expands. */}
          <div className="tt-cover pointer-events-none absolute inset-x-[39%] inset-y-[28%] z-[6] overflow-hidden">
            <img
              src="/dayana-photos/opt/IMG_4009-900.webp"
              alt="Dayana Beltrán"
              className="absolute inset-0 h-full w-full object-cover object-top opacity-95 mix-blend-luminosity contrast-[1.08]"
              loading="lazy"
              decoding="async"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ background: "linear-gradient(180deg, rgba(120,46,30,0.35) 0%, transparent 28%, transparent 46%, rgba(120,46,30,0.55) 78%, #9a4129 100%)" }}
            />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between px-[5vw] pt-[5vw] font-[font2] text-[2.4vw] uppercase tracking-[0.24em] text-white/85 lg:px-[1.6vw] lg:pt-[1.5vw] lg:text-[0.72vw]">
              <span>Voces reales</span>
              <span className="text-white/55">04</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 px-[5vw] pb-[5vw] lg:px-[1.6vw] lg:pb-[1.6vw]">
              <h3 className="font-[font2] text-[8vw] uppercase leading-[0.85] text-white lg:text-[2.1vw]">
                Historias<br />reales
              </h3>
              <p className="mt-[1.4vw] font-[font1] text-[3vw] leading-snug text-white/80 lg:mt-[0.6vw] lg:text-[0.8vw]">
                Transformaciones reales, contadas en video.
              </p>
            </div>
          </div>

          <div className="tt-overlay absolute inset-0 z-10 text-white opacity-0">
            {/* label */}
            <div className="absolute inset-x-[7vw] top-[7vw] flex items-center justify-between font-[font2] text-[3vw] uppercase tracking-[0.24em] lg:inset-x-[4vw] lg:top-[4vw] lg:text-[0.9vw]">
              <span>Voces reales</span>
              <span className="text-white/55">Testimonios</span>
            </div>

            {/* names band — vertically centred, slides horizontally */}
            <div className="absolute inset-x-0 top-[30%] overflow-hidden px-[7vw] lg:top-[28%] lg:px-[4vw]">
              <h3 className="tt-heading flex w-max items-center gap-[10vw] whitespace-nowrap font-[font2] text-[22vw] uppercase leading-[0.85] tracking-tight will-change-transform lg:gap-[7vw] lg:text-[8.5vw]">
                {testimonials.map((t, idx) => (
                  <span key={t.id} className={`tt-name tt-name-${idx}`}>
                    {t.name}
                  </span>
                ))}
              </h3>
            </div>

            {/* quote — bottom-left, FIXED vw width so SplitText wraps correctly */}
            <div className="absolute bottom-[7vw] left-[7vw] w-[82vw] lg:bottom-[4vw] lg:left-[4vw] lg:w-[42vw]">
              <div className="relative h-[40vw] min-h-[32vw] lg:h-[11vw] lg:min-h-[9vw]">
                {testimonials.map((t, idx) => (
                  <p
                    key={t.id}
                    className={`tt-desc tt-desc-${idx} absolute inset-0 m-0 w-full font-[font1] text-[4vw] leading-[1.5] lg:text-[1.2vw]`}
                  >
                    “{t.excerpt}”
                  </p>
                ))}
              </div>
            </div>

            {/* video — bottom-right, the current person, cross-fades with the cycle */}
            <div className="pointer-events-auto absolute bottom-[7vw] right-[7vw] w-[58vw] lg:bottom-[4vw] lg:right-[4vw] lg:w-[34vw]">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl shadow-[0_1vw_3vw_rgba(0,0,0,0.35)]">
                {testimonials.map((t, idx) => (
                  <div key={t.id} className={`tt-vid tt-vid-${idx} absolute inset-0`}>
                    <Tile t={t} uid={`p${idx}`} playing={playingUid === `p${idx}`} onPlay={setPlayingUid} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
