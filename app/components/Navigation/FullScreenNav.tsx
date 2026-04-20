"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useContext, useRef } from "react";
import { NavbarContext } from "../../context/NavContext";

type MenuItem = {
  label: string;
  href: string;
  marquee: string;
};

const menuItems: MenuItem[] = [
  { label: "Inicio", href: "#hero", marquee: "Cambia tu realidad" },
  { label: "Servicios", href: "#servicios", marquee: "Terapias y cursos en vivo" },
  { label: "Testimonios", href: "#testimonios", marquee: "Historias reales" },
  { label: "Contacto", href: "#contacto", marquee: "Hablemos por WhatsApp" },
];

const FullScreenNav = () => {
  const fullNavLinksRef = useRef<HTMLDivElement>(null);
  const fullScreenRef = useRef<HTMLDivElement>(null);

  const [navOpen, setNavOpen] = useContext(NavbarContext);

  function gsapAnimation() {
    const tl = gsap.timeline();
    tl.to(".fullscreennav", { display: "block" });
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
      className="fullscreennav hidden text-white overflow-hidden h-screen w-full z-50 fixed top-0 left-0"
    >
      <div className="h-screen w-full fixed">
        <div className="h-full w-full flex">
          <div className="stairing h-full w-1/5 bg-black"></div>
          <div className="stairing h-full w-1/5 bg-linen"></div>
          <div className="stairing h-full w-1/5 bg-ember"></div>
          <div className="stairing h-full w-1/5 bg-linen"></div>
          <div className="stairing h-full w-1/5 bg-black"></div>
        </div>
      </div>
      <div ref={fullNavLinksRef} className="relative">
        <div className="navlink flex w-full justify-between lg:p-5 p-2 items-start">
          <a
            href="#hero"
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
          <div
            onClick={() => setNavOpen(false)}
            className="lg:h-24 h-16 w-16 lg:w-24 relative cursor-pointer"
          >
            <div className="lg:h-32 h-20 lg:w-1 w-0.5 -rotate-45 origin-top absolute bg-linen"></div>
            <div className="lg:h-32 h-20 lg:w-1 w-0.5 right-0 rotate-45 origin-top absolute bg-linen"></div>
          </div>
        </div>

        <div className="py-20 lg:py-28">
          {menuItems.map((item, idx) => (
            <a
              key={item.label}
              href={item.href}
              onClick={handleMenuClick}
              className={`link origin-top relative block border-t border-white ${
                idx === menuItems.length - 1 ? "border-b" : ""
              }`}
            >
              <h1 className="font-[font2] text-5xl lg:text-[8vw] text-center lg:leading-[0.8] lg:pt-10 pt-3 pb-3 lg:pb-0 uppercase">
                {item.label}
              </h1>
              <div className="moveLink absolute text-black flex top-0 bg-linen w-full h-full overflow-hidden items-center">
                <div className="moveX flex items-center shrink-0">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className="whitespace-nowrap font-[font2] lg:text-[8vw] text-5xl lg:leading-[0.8] uppercase px-6 lg:px-12 flex items-center gap-6 lg:gap-12"
                    >
                      {item.marquee}
                      <span className="inline-block w-3 h-3 lg:w-5 lg:h-5 rounded-full bg-black shrink-0"></span>
                    </span>
                  ))}
                </div>
                <div className="moveX flex items-center shrink-0">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className="whitespace-nowrap font-[font2] lg:text-[8vw] text-5xl lg:leading-[0.8] uppercase px-6 lg:px-12 flex items-center gap-6 lg:gap-12"
                    >
                      {item.marquee}
                      <span className="inline-block w-3 h-3 lg:w-5 lg:h-5 rounded-full bg-black shrink-0"></span>
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
