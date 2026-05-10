"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactNode, useRef } from "react";
import { usePathname } from "next/navigation";

gsap.registerPlugin(ScrollTrigger);

const Stairs = ({ children }: { children: ReactNode }) => {
  const currentPath = usePathname();

  const stairParentRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!stairParentRef.current || !pageRef.current) return;
      const stairs = gsap.utils.toArray<HTMLElement>(
        ".stair",
        stairParentRef.current
      );
      if (stairs.length === 0) return;

      const failSafeTimer = window.setTimeout(() => {
        if (stairParentRef.current) {
          gsap.set(stairParentRef.current, { display: "none", autoAlpha: 0 });
        }
        if (pageRef.current) {
          gsap.set(pageRef.current, { opacity: 1, clearProps: "opacity" });
        }
      }, 2200);

      const tl = gsap.timeline({
        onComplete: () => {
          window.clearTimeout(failSafeTimer);
          try {
            ScrollTrigger.refresh();
          } catch {
            // Never block the whole page if refresh fails during route transitions.
          }
        },
      });
      tl.set(stairParentRef.current, { display: "block", autoAlpha: 1 });
      tl.from(stairs, {
        height: 0,
        stagger: { amount: -0.2 },
      });
      tl.to(stairs, {
        y: "100%",
        stagger: { amount: -0.25 },
      });
      tl.set(stairParentRef.current, { display: "none", autoAlpha: 0 });
      tl.set(stairs, { y: "0%" });

      gsap.fromTo(
        pageRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: "power2.out" }
      );
    },
    { dependencies: [currentPath], scope: stairParentRef }
  );

  return (
    <div>
      <div
        ref={stairParentRef}
        className="fixed inset-0 z-[100] flex h-[100dvh] w-full pointer-events-none bg-black"
        aria-hidden="true"
      >
        <div className="flex h-full w-full">
          <div className="stair h-full w-1/5 bg-blush"></div>
          <div className="stair h-full w-1/5 bg-linen"></div>
          <div className="stair h-full w-1/5 bg-sand"></div>
          <div className="stair h-full w-1/5 bg-linen"></div>
          <div className="stair h-full w-1/5 bg-blush"></div>
        </div>
      </div>
      <div ref={pageRef} className="opacity-0">
        {children}
      </div>
    </div>
  );
};

export default Stairs;
