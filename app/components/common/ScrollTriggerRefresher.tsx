"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ScrollTriggerRefresher = () => {
  useEffect(() => {
    let rafId: number | null = null;
    let timeoutId: number | null = null;
    const safeRefresh = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(() => {
          try {
            ScrollTrigger.refresh();
          } catch {
            // Ignore transient DOM state during hydration/iframe mutations.
          }
        });
      }, 80);
    };

    const timers: number[] = [];
    timers.push(window.setTimeout(safeRefresh, 120));
    timers.push(window.setTimeout(safeRefresh, 700));

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(safeRefresh).catch(() => undefined);
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") safeRefresh();
    };
    window.addEventListener("load", safeRefresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("load", safeRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
};

export default ScrollTriggerRefresher;
