"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { RefObject } from "react";

gsap.registerPlugin(ScrollTrigger);

type Options = {
  tilt?: number;
  isLast?: boolean;
  tiltScrubEnd?: string;
};

export const useStackingSection = (
  sectionRef: RefObject<HTMLElement | null>,
  innerRef: RefObject<HTMLDivElement | null>,
  { tilt = -4, isLast = false, tiltScrubEnd = "top 30%" }: Options = {}
) => {
  useGSAP(
    () => {
      if (!sectionRef.current || !innerRef.current) return;

      gsap.fromTo(
        innerRef.current,
        { rotation: tilt },
        {
          rotation: 0,
          ease: "none",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top bottom",
            end: tiltScrubEnd,
            scrub: true,
            invalidateOnRefresh: true,
          },
        }
      );

      if (!isLast) {
        ScrollTrigger.create({
          trigger: sectionRef.current,
          start: "bottom bottom",
          end: "bottom top",
          pin: true,
          pinSpacing: false,
          invalidateOnRefresh: true,
        });
      }
    },
    { scope: sectionRef }
  );
};
