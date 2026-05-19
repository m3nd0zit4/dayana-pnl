"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useContext, useRef } from "react";
import { usePathname } from "next/navigation";
import { NavbarContext } from "../../context/NavContext";

type MenuItem =
  | {
      label: string;
      marquee: string;
      hash: string;
      /** Texto corto al lado del label (p. ej. promo con fecha límite). */
      announcement?: string;
    }
  | {
      label: string;
      marquee: string;
      path: string;
      announcement?: string;
    };

const menuItemsBase: MenuItem[] = [
  { label: "Inicio", hash: "#hero", marquee: "Cambia tu realidad" },
  { label: "Servicios", hash: "#servicios", marquee: "Terapias y cursos en vivo" },
  { label: "Testimonios", hash: "#testimonios", marquee: "Historias reales" },
  { label: "Contacto", hash: "#contacto", marquee: "Hablemos por WhatsApp" },
  { label: "Redes", hash: "#redes", marquee: "Sigue a Dayana" },
];

const tallerVirtualItem: MenuItem = {
  label: "Taller virtual",
  path: "/taller-virtual",
  marquee: "Próximo taller virtual",
  announcement: "Próximamente",
};

const menuItems: MenuItem[] = [
  ...menuItemsBase.slice(0, 3),
  tallerVirtualItem,
  ...menuItemsBase.slice(3),
];

/** Tamaños originales del menú (antes del primer ajuste por clamp). */
const linkTitleClass =
  "font-[font2] text-4xl lg:text-[6.2vw] text-center lg:leading-[0.85] uppercase " +
  "pt-3 pb-3 lg:pt-5 lg:pb-4";

const marqueeRowClass =
  "whitespace-nowrap font-[font2] lg:text-[6.2vw] text-4xl lg:leading-[0.85] uppercase " +
  "px-6 lg:px-12 flex items-center gap-6 lg:gap-12";

const FullScreenNav = () => {
  const fullNavLinksRef = useRef<HTMLDivElement>(null);
  const fullScreenRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const resolveHref = (item: MenuItem) =>
    "path" in item
      ? item.path
      : pathname === "/"
        ? item.hash
        : `/${item.hash}`;

  const homeHref = pathname === "/" ? "#hero" : "/#hero";

  const [navOpen, setNavOpen] = useContext(NavbarContext);

  function gsapAnimation() {
    const tl = gsap.timeline();
    tl.to(".fullscreennav", { display: "flex" });
    tl.to(".stairing", {
      delay: 0.2,
      height: "100%",
      stagger: { amount: -0.3 },
    });
    tl.to(".link", {
      opacity: 1,
      rotateX: 0,
      stagger: { amount: 0.3 },
    });
    tl.to(".navlink", { opacity: 1 });
  }

  function gsapAnimationReverse() {
    const tl = gsap.timeline();
    tl.to(".link", {
      opacity: 0,
      rotateX: 90,
      stagger: { amount: 0.1 },
    });
    tl.to(".stairing", {
      height: 0,
      stagger: { amount: 0.1 },
    });
    tl.to(".navlink", { opacity: 0 });
    tl.to(".fullscreennav", { display: "none" });
  }

  useGSAP(
    () => {
      if (navOpen) {
        gsapAnimation();
      } else {
        gsapAnimationReverse();
      }
    },
    [navOpen]
  );

  const handleMenuClick = () => {
    setNavOpen(false);
  };

  return (
    <div
      ref={fullScreenRef}
      id="fullscreennav"
      className="fullscreennav hidden fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden text-white"
    >
      <div className="pointer-events-none absolute inset-0 h-full w-full">
        <div className="flex h-full w-full">
          <div className="stairing h-full w-1/5 bg-black" />
          <div className="stairing h-full w-1/5 bg-blush" />
          <div className="stairing h-full w-1/5 bg-linen" />
          <div className="stairing h-full w-1/5 bg-sand" />
          <div className="stairing h-full w-1/5 bg-black" />
        </div>
      </div>

      <div
        ref={fullNavLinksRef}
        className="relative z-[1] flex min-h-0 w-full flex-1 flex-col"
      >
        <div className="navlink flex w-full shrink-0 justify-between items-start p-3 sm:p-4 lg:p-6 lg:pr-8">
          <a
            href={homeHref}
            onClick={handleMenuClick}
            className="font-[font2] uppercase leading-none select-none text-white"
            aria-label="Dayana Beltrán — Maestra en PNL"
          >
            <div className="text-sm lg:text-base tracking-[0.14em]">
              Dayana Beltrán
            </div>
            <div className="text-[10px] lg:text-xs tracking-[0.5em] mt-1.5 opacity-70">
              Maestra PNL
            </div>
          </a>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            className="lg:h-24 h-16 w-16 lg:w-24 relative cursor-pointer shrink-0 border-0 bg-transparent p-0"
            aria-label="Cerrar menú"
          >
            <span className="pointer-events-none absolute left-0 top-0 h-20 w-0.5 -rotate-45 origin-top bg-linen lg:h-32 lg:w-1" />
            <span className="pointer-events-none absolute right-0 top-0 h-20 w-0.5 rotate-45 origin-top bg-linen lg:h-32 lg:w-1" />
          </button>
        </div>

        <div
          data-lenis-prevent
          className="min-h-0 flex-1 w-full touch-pan-y overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 py-6 sm:px-5 sm:py-8 lg:px-10 lg:py-12 [scrollbar-gutter:stable]"
        >
          {menuItems.map((item, idx) => (
            <a
              key={"path" in item ? item.path : item.hash}
              href={resolveHref(item)}
              onClick={handleMenuClick}
              className={`link origin-top relative block border-t border-white/90 first:border-t-white ${
                idx === menuItems.length - 1 ? "border-b border-b-white/90" : ""
              }`}
            >
              <div className="flex flex-col items-center justify-center gap-2 sm:gap-2.5">
                <div className="flex w-full max-w-none flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:gap-x-4 px-1">
                  <h2 className={linkTitleClass}>{item.label}</h2>
                  {item.announcement ? (
                    <span
                      className="shrink-0 inline-flex max-w-[min(100%,24rem)] items-center rounded-full border border-white/45 bg-white/14 px-3 py-1.5 sm:px-4 sm:py-2 text-center font-[font1] text-[10px] uppercase leading-snug tracking-[0.14em] text-white sm:text-xs lg:text-sm sm:tracking-[0.16em]"
                      aria-label={item.announcement}
                    >
                      {item.announcement}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="moveLink absolute left-0 top-0 flex h-full w-full items-center overflow-hidden bg-linen text-black">
                <div className="moveX flex shrink-0 items-center">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className={marqueeRowClass}>
                      {item.marquee}
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-black sm:h-3.5 sm:w-3.5 lg:h-4 lg:w-4" />
                    </span>
                  ))}
                </div>
                <div className="moveX flex shrink-0 items-center">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className={marqueeRowClass}>
                      {item.marquee}
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-black sm:h-3.5 sm:w-3.5 lg:h-4 lg:w-4" />
                    </span>
                  ))}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FullScreenNav;
