"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";
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
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  useEffect(() => {
    if (!sectionRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        setShouldLoadVideo(true);
        observer.disconnect();
      },
      { root: null, rootMargin: "220px 0px", threshold: 0.01 }
    );

    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoadVideo) return;
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
  }, [shouldLoadVideo]);

  useGSAP(
    () => {
      if (!sectionRef.current) return;

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;

      gsap.set(phraseRefs.current.slice(1), { opacity: 0, yPercent: 60 });

      if (videoRef.current && shouldLoadVideo) {
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

      if (isDesktop) {
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
        return;
      }

      if (prefersReducedMotion) return;

      const loopTl = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });
      for (let i = 1; i < phrases.length; i++) {
        loopTl.to(
          phraseRefs.current[i - 1],
          {
            opacity: 0,
            yPercent: -60,
            duration: 0.65,
            ease: "power2.inOut",
          },
          "+=0.8"
        );
        loopTl.to(
          phraseRefs.current[i],
          {
            opacity: 1,
            yPercent: 0,
            duration: 0.65,
            ease: "power2.inOut",
          },
          "<+=0.15"
        );
      }
      loopTl.to(
        phraseRefs.current[phrases.length - 1],
        {
          opacity: 0,
          yPercent: -60,
          duration: 0.65,
          ease: "power2.inOut",
        },
        "+=0.8"
      );
      loopTl.to(
        phraseRefs.current[0],
        {
          opacity: 1,
          yPercent: 0,
          duration: 0.65,
          ease: "power2.inOut",
        },
        "<+=0.15"
      );
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
        {shouldLoadVideo ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/video-poster.webp"
            className="absolute inset-0 h-full w-full object-cover will-change-transform"
          >
            <source src="/video.webm" type="video/webm" />
            <source src="/video.mp4" type="video/mp4" />
          </video>
        ) : (
          <img
            src="/video-poster.webp"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            decoding="async"
          />
        )}
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
