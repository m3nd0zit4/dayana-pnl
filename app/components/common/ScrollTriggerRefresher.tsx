"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ScrollTriggerRefresher = () => {
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();

    const timers: number[] = [];
    timers.push(window.setTimeout(refresh, 100));
    timers.push(window.setTimeout(refresh, 600));
    timers.push(window.setTimeout(refresh, 1800));

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refresh).catch(() => undefined);
    }

    window.addEventListener("load", refresh);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("load", refresh);
    };
  }, []);

  return null;
};

export default ScrollTriggerRefresher;
