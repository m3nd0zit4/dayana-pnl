"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { NavbarColorContext, NavbarContext } from "../../context/NavContext";

const Navbar = () => {
  const navGreenRef = useRef<HTMLDivElement>(null);
  const [, setNavOpen] = useContext(NavbarContext);
  const [navColor, setNavColor] = useContext(NavbarColorContext);
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isLoggedInMember =
    status === "authenticated" && session?.user?.kind === "member";
  const homeHref = pathname === "/" ? "#hero" : "/#hero";
  const isHome = pathname === "/";
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
      {/* Home shows the DB mark via the masthead intro; other routes show it here. */}
      {!isHome && (
        <div
          className={`overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-transform lg:p-5 p-3 pointer-events-auto ${
            logoVisible
              ? "translate-y-0 opacity-100"
              : "-translate-y-[140%] opacity-0 pointer-events-none"
          }`}
        >
          <a
            href={homeHref}
            className="block uppercase leading-none select-none text-2xl lg:text-[28px]"
            style={{ color: navColor, fontFamily: "var(--font-grotesk)", fontWeight: 700, letterSpacing: "-0.02em" }}
            aria-label="Dayana Beltrán"
          >
            DB<span style={{ color: "var(--color-terracotta)" }}>.</span>
          </a>
        </div>
      )}
      <div className="flex items-center pointer-events-auto">
        <div
          onClick={() => setNavOpen(true)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="lg:h-10 h-8 bg-black relative lg:w-28 w-20 cursor-pointer"
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
        <a
          href={isLoggedInMember ? "/miembros" : "/acceso"}
          className="group relative hidden sm:inline-flex items-center overflow-hidden rounded-full border lg:px-5 px-4 lg:py-2.5 py-2 uppercase lg:text-xs text-[11px] tracking-[0.18em] ml-3 lg:ml-4"
          style={{ borderColor: navColor, fontFamily: "var(--font-grotesk)" }}
        >
          <span
            className="absolute inset-0 -translate-x-full bg-terracotta transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.35,1)] group-hover:translate-x-0"
            aria-hidden
          />
          <span
            className="relative transition-colors duration-500 delay-75 group-hover:text-white"
            style={{ color: navColor }}
          >
            {isLoggedInMember
              ? (session?.user?.name?.split(" ")[0] ?? "Mi cuenta")
              : "Ingresar"}
          </span>
        </a>
      </div>
    </div>
  );
};

export default Navbar;
