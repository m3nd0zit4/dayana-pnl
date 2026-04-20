"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import HomeBottomText from "./HomeBottomText";

gsap.registerPlugin(ScrollTrigger);

const phrases: Array<[string, string]> = [
  ["Cambiamos", "Realidades"],
  ["Cambiamos", "Creencias"],
  ["Cambiamos", "Tu vida"],
];

const HomeHero = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const phraseRefs = useRef<Array<HTMLDivElement | null>>([]);

  useGSAP(
    () => {
      if (!sectionRef.current) return;

      gsap.set(phraseRefs.current.slice(1), { opacity: 0, yPercent: 60 });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "+=1600",
          pin: true,
          scrub: 0.3,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      for (let i = 1; i < phrases.length; i++) {
        tl.to(
          phraseRefs.current[i - 1],
          {
            opacity: 0,
            yPercent: -60,
            duration: 1,
            ease: "power2.inOut",
          },
          "+=0.6"
        );
        tl.to(
          phraseRefs.current[i],
          {
            opacity: 1,
            yPercent: 0,
            duration: 1,
            ease: "power2.inOut",
          },
          "<+=0.25"
        );
      }

      tl.to(
        contentRef.current,
        {
          scale: 0.92,
          filter: "brightness(0.5)",
          borderRadius: "28px",
          duration: 1,
          ease: "power2.inOut",
        },
        "+=0.5"
      );
    },
    { scope: sectionRef }
  );

  return (
    <section
      ref={sectionRef}
      id="hero"
      data-nav-color="white"
      className="bg-black text-white relative"
    >
      <div
        ref={contentRef}
        className="h-screen w-screen relative overflow-hidden flex flex-col justify-between pb-5 will-change-transform origin-center"
      >
        <div className="flex-1 flex items-center justify-center relative mt-24 lg:mt-0">
          <div className="relative w-full text-center font-[font1]">
            {phrases.map((phrase, i) => (
              <div
                key={i}
                ref={(el) => {
                  phraseRefs.current[i] = el;
                }}
                className={
                  (i === 0 ? "relative" : "absolute inset-0") +
                  " flex flex-col items-center justify-center will-change-transform"
                }
              >
                <div className="lg:text-[12vw] text-[16vw] uppercase lg:leading-[10vw] leading-[14vw]">
                  {phrase[0]}
                </div>
                <div className="lg:text-[12vw] text-[16vw] uppercase lg:leading-[10vw] leading-[14vw]">
                  {phrase[1]}
                </div>
              </div>
            ))}
          </div>
        </div>

        <HomeBottomText />
      </div>
    </section>
  );
};

export default HomeHero;
