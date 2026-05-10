"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavbarColorContext, NavbarContext } from "../../context/NavContext";

const Navbar = () => {
  const navGreenRef = useRef<HTMLDivElement>(null);
  const [, setNavOpen] = useContext(NavbarContext);
  const [navColor, setNavColor] = useContext(NavbarColorContext);
  const pathname = usePathname();
  const homeHref = pathname === "/" ? "#hero" : "/#hero";
  const [logoVisible, setLogoVisible] = useState(true);

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-nav-color]");
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const color = visible.target.getAttribute("data-nav-color");
          if (color) setNavColor(color);
        }
      },
      { threshold: [0.25, 0.5, 0.75] }
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [setNavColor]);

  /** Solo el logo: oculto al bajar cuando ya pasamos el hero; visible al subir o cerca del tope. */
  const pastHeroRef = useRef(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) {
      pastHeroRef.current = true;
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        pastHeroRef.current = !entry.isIntersecting;
      },
      { threshold: 0, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(hero);
    return () => io.disconnect();
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setLogoVisible(true);
      return;
    }

    const nearTopPx = 56;
    const onLenisScroll = (e: Event) => {
      const ce = e as CustomEvent<{ scroll: number; direction: number }>;
      const scroll = ce.detail?.scroll ?? 0;
      const direction = ce.detail?.direction ?? 0;

      if (scroll <= nearTopPx) {
        setLogoVisible(true);
        return;
      }
      if (!pastHeroRef.current) {
        setLogoVisible(true);
        return;
      }
      // Lenis: direction 1 = scroll hacia arriba, -1 = hacia abajo (README oficial).
      if (direction === 1) setLogoVisible(true);
      else if (direction === -1) setLogoVisible(false);
    };

    window.addEventListener("lenis-scroll", onLenisScroll);
    return () => window.removeEventListener("lenis-scroll", onLenisScroll);
  }, [pathname]);

  const handleMouseEnter = () => {
    if (navGreenRef.current) navGreenRef.current.style.height = "100%";
  };

  const handleMouseLeave = () => {
    if (navGreenRef.current) navGreenRef.current.style.height = "0%";
  };

  return (
    <div className="z-30 flex fixed top-0 w-full items-start justify-between pointer-events-none">
      <div
        className={`overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-transform lg:p-5 p-3 pointer-events-auto ${
          logoVisible
            ? "translate-y-0 opacity-100"
            : "-translate-y-[140%] opacity-0 pointer-events-none"
        }`}
      >
        <a
          href={homeHref}
          className="block font-[font2] uppercase leading-none select-none"
          style={{ color: navColor }}
          aria-label="Dayana Beltran PNL"
        >
          <span className="block text-sm lg:text-base tracking-[0.14em]">
            Dayana Beltr&aacute;n
          </span>
          <span className="block text-[10px] lg:text-xs tracking-[0.5em] mt-1.5 opacity-70">
            PNL
          </span>
        </a>
      </div>
      <div
        onClick={() => setNavOpen(true)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="lg:h-10 h-8 bg-black relative lg:w-28 w-20 cursor-pointer pointer-events-auto"
      >
        <div
          ref={navGreenRef}
          className="bg-linen transition-all absolute top-0 h-0 w-full"
        />
        <div className="relative h-full lg:px-6 px-5 flex flex-col justify-center items-end gap-1">
          <div className="lg:w-10 w-7 h-0.5 bg-white" />
          <div className="lg:w-6 w-4 h-0.5 bg-white" />
        </div>
      </div>
    </div>
  );
};

export default Navbar;
