"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import HomeBottomText from "./HomeBottomText";

gsap.registerPlugin(ScrollTrigger);

const phrases: Array<[string, string]> = [
  ["Cambiamos", "Realidades"],
  ["Cambiamos", "Creencias"],
  ["Cambiamos", "Tu vida"],
];

const HomeHero = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const phraseRefs = useRef<Array<HTMLDivElement | null>>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => {
      v.play().catch(() => {
        // Autoplay may be blocked until user interaction; retry silently on first click
        const resume = () => {
          v.play().finally(() => {
            window.removeEventListener("click", resume);
            window.removeEventListener("touchstart", resume);
          });
        };
        window.addEventListener("click", resume, { once: true });
        window.addEventListener("touchstart", resume, { once: true });
      });
    };
    if (v.readyState >= 2) tryPlay();
    else v.addEventListener("loadeddata", tryPlay, { once: true });
  }, []);

  useGSAP(
    () => {
      if (!sectionRef.current) return;

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      gsap.set(phraseRefs.current.slice(1), { opacity: 0, yPercent: 60 });

      if (videoRef.current) {
        gsap.set(videoRef.current, {
          opacity: 0,
          scale: 1,
          filter: "blur(0px)",
        });

        if (prefersReducedMotion) {
          gsap.set(videoRef.current, {
            opacity: 1,
            filter: "blur(0px)",
          });
        } else {
          gsap.to(videoRef.current, {
            opacity: 1,
            duration: 1.6,
            ease: "power2.out",
            delay: 0.1,
          });
        }
      }

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "+=1200",
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

        if (i === 2 && overlayRef.current && !prefersReducedMotion) {
          tl.to(
            overlayRef.current,
            {
              opacity: 0.2,
              duration: 1.1,
              ease: "none",
            },
            "<"
          );
        }
      }
    },
    { scope: sectionRef }
  );

  return (
    <section
      ref={sectionRef}
      id="hero"
      data-nav-color="white"
      className="bg-black text-white relative overflow-hidden"
    >
      <div className="absolute inset-0 z-0 pointer-events-none">
        <video
          ref={videoRef}
          src="/video.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover will-change-transform"
        />
        <div
          ref={overlayRef}
          className="absolute inset-0 bg-black"
          style={{ opacity: 0.3 }}
        />
      </div>

      <div className="relative z-10 h-screen w-screen overflow-hidden flex flex-col justify-between pb-5">
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
                style={{
                  textShadow: "0 2px 40px rgba(0,0,0,0.55)",
                }}
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
