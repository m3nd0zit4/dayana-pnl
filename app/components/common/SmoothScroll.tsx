"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const SmoothScroll = () => {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });

    lenis.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => {
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const scrollToHash = (hash: string, delayMs = 0) => {
      if (!hash || hash === "#" || hash.length < 2) return false;
      const el = document.querySelector<HTMLElement>(hash);
      if (!el) return false;
      const run = () => lenis.scrollTo(el, { offset: 0, duration: 1.2 });
      if (delayMs > 0) window.setTimeout(run, delayMs);
      else run();
      return true;
    };

    const handleAnchorClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
        return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href") || "";
      let hash = "";
      if (href.startsWith("#")) {
        hash = href;
      } else if (href.startsWith("/#")) {
        if (window.location.pathname !== "/") return;
        hash = href.substring(1);
      } else {
        return;
      }

      if (scrollToHash(hash)) {
        e.preventDefault();
        history.replaceState(null, "", hash);
      }
    };

    document.addEventListener("click", handleAnchorClick);

    if (window.location.hash) {
      window.setTimeout(() => scrollToHash(window.location.hash), 50);
    }

    return () => {
      document.removeEventListener("click", handleAnchorClick);
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return null;
};

export default SmoothScroll;
