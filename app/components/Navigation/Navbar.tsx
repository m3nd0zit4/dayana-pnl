"use client";

import { useContext, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NavbarColorContext, NavbarContext } from "../../context/NavContext";

const Navbar = () => {
  const navGreenRef = useRef<HTMLDivElement>(null);
  const [, setNavOpen] = useContext(NavbarContext);
  const [navColor, setNavColor] = useContext(NavbarColorContext);
  const pathname = usePathname();
  const homeHref = pathname === "/" ? "#hero" : "/#hero";

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

  const handleMouseEnter = () => {
    if (navGreenRef.current) navGreenRef.current.style.height = "100%";
  };

  const handleMouseLeave = () => {
    if (navGreenRef.current) navGreenRef.current.style.height = "0%";
  };

  return (
    <div className="z-30 flex fixed top-0 w-full items-start justify-between pointer-events-none">
      <a
        href={homeHref}
        className="lg:p-5 p-3 pointer-events-auto font-[font2] uppercase leading-none select-none"
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
