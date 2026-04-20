"use client";

import { useEffect, useRef } from "react";

const ScrollProgress = () => {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      if (!barRef.current) return;
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? scrollTop / docHeight : 0;
      barRef.current.style.transform = `scaleY(${progress})`;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="fixed top-0 right-0 h-screen w-[3px] z-40 pointer-events-none bg-black/10">
      <div
        ref={barRef}
        className="h-full w-full origin-top"
        style={{
          transform: "scaleY(0)",
          background: "linear-gradient(to bottom, #e0d5c6, #a85c3e)",
        }}
      />
    </div>
  );
};

export default ScrollProgress;
