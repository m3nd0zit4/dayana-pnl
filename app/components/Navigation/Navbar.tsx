"use client";

import { useContext, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NavbarColorContext, NavbarContext } from "../../context/NavContext";
import AccountMenu from "./AccountMenu";

const Navbar = () => {
  const navGreenRef = useRef<HTMLDivElement>(null);
  const [, setNavOpen] = useContext(NavbarContext);
  const [navColor, setNavColor] = useContext(NavbarColorContext);
  const pathname = usePathname();
  const homeHref = pathname === "/" ? "#hero" : "/#hero";
  const isHome = pathname === "/";

  // Re-suscribe en cada cambio de ruta: el Navbar persiste entre navegaciones
  // y las secciones observadas son nodos nuevos en cada página.
  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-nav-color]");
    if (sections.length === 0) return;

    // Solo importa la sección que cruza la franja superior (donde vive el
    // header). Con threshold por ratio, las secciones más altas que el
    // viewport nunca alcanzaban el 25% visible y el color no cambiaba.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const color = entry.target.getAttribute("data-nav-color");
          if (color) setNavColor(color);
        }
      },
      { rootMargin: "0px 0px -92% 0px", threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [pathname, setNavColor]);

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
        <div className="lg:p-5 p-3 pointer-events-auto">
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
      {/* ml-auto: on the home page the logo slot above is absent, and
          justify-between with a single child would push this cluster to the
          LEFT edge — dragging the account menu (right-anchored, 210px wide)
          past the left viewport edge, where it rendered clipped. */}
      <div className="ml-auto flex items-center pointer-events-auto">
        <div
          onClick={() => setNavOpen(true)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={`group lg:h-10 h-8 bg-black relative lg:w-28 w-20 cursor-pointer border ${
            navColor === "white" ? "border-white/40" : "border-transparent"
          }`}
        >
          <div
            ref={navGreenRef}
            className="bg-linen transition-all absolute top-0 h-0 w-full"
          />
          <div className="relative h-full lg:px-6 px-5 flex flex-col justify-center items-end gap-1">
            <div className="lg:w-10 w-7 h-0.5 bg-white transition-colors group-hover:bg-black" />
            <div className="lg:w-6 w-4 h-0.5 bg-white transition-colors group-hover:bg-black" />
          </div>
        </div>
        <AccountMenu navColor={navColor} />
      </div>
    </div>
  );
};

export default Navbar;
