"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactNode, useRef } from "react";
import { usePathname } from "next/navigation";

gsap.registerPlugin(ScrollTrigger);

const Stairs = ({ children }: { children: ReactNode }) => {
  const currentPath = usePathname();

  /** Scope both layers so Strict Mode / context revert does not strand the page at opacity 0. */
  const rootRef = useRef<HTMLDivElement>(null);
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
          gsap.set(stairParentRef.current, { display: "none", autoAlpha: 1 });
        }
        if (pageRef.current) {
          gsap.set(pageRef.current, { opacity: 1 });
        }
        gsap.set(stairs, { y: "0%", clearProps: "height" });
      }, 4000);

      const finish = () => {
        if (stairParentRef.current) {
          gsap.set(stairParentRef.current, { display: "none", autoAlpha: 1 });
        }
        if (pageRef.current) {
          gsap.set(pageRef.current, { opacity: 1 });
        }
        gsap.set(stairs, { y: "0%", clearProps: "height" });
      };

      const tl = gsap.timeline({
        onComplete: () => {
          window.clearTimeout(failSafeTimer);
          finish();
          try {
            ScrollTrigger.refresh();
          } catch {
            // Never block the whole page if refresh fails during route transitions.
          }
        },
      });

      tl.set(stairParentRef.current, { display: "flex", autoAlpha: 1 });
      tl.set(pageRef.current, { opacity: 0 });

      tl.from(stairs, {
        height: 0,
        duration: 0.7,
        ease: "power2.out",
        stagger: { amount: -0.22 },
        transformOrigin: "50% 100%",
      });

      // Mientras las columnas aún "suben" con stagger, hay huecos transparentes: si la
      // página sigue en opacity 0 solo se ve el body (#000). Solapamos la entrada del
      // contenido un poco antes de que termine el crecimiento para que esos huecos
      // muestren el hero; un solape menor (-=0.3 vs -=0.5) deja ~0,2s más de negro visible.
      tl.to(
        pageRef.current,
        { opacity: 1, duration: 0.75, ease: "power2.out" },
        "-=0.3"
      );

      tl.to(stairs, {
        y: "100%",
        duration: 0.8,
        ease: "power2.inOut",
        stagger: { amount: -0.28 },
      });

      tl.to(stairParentRef.current, {
        autoAlpha: 0,
        duration: 0.35,
        ease: "power2.out",
      });
    },
    { dependencies: [currentPath], scope: rootRef }
  );

  return (
    <div ref={rootRef} className="relative isolate min-h-dvh">
      <div
        ref={pageRef}
        className="relative z-0 min-h-dvh opacity-0 [will-change:opacity]"
      >
        {children}
      </div>
      <div
        ref={stairParentRef}
        className="fixed inset-0 z-[100] flex h-[100dvh] w-full pointer-events-none bg-transparent hidden"
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
    </div>
  );
};

export default Stairs;
