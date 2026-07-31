"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactSiriwave from "react-siriwave";
import type SiriWaveInstance from "siriwave";
import { cn } from "@/lib/utils";

/**
 * Fluid Siri-style waveform shown in place of the composer's text field while
 * dictation is recording — see `useSpeechToText`'s `volume` (0..1, resampled
 * from the mic on every animation frame). react-siriwave/siriwave.js is the
 * off-the-shelf component for exactly this, swapped in for a hand-rolled bar
 * visualizer.
 *
 * Its React wrapper recreates the whole canvas on every prop change (its
 * effect depends on every prop, `amplitude`/`speed` included — see
 * node_modules/react-siriwave/dist/esm/components/App.js), which would mean
 * a full teardown/rebuild on every animation frame if volume were passed
 * straight through as a prop. Instead `onInit` captures the underlying
 * SiriWave instance once; every volume update drives it directly via
 * `.setAmplitude`/`.setSpeed`, which lerp smoothly with no recreation.
 *
 * react-siriwave's own defaults (640x200) always win over whatever the
 * container measures, because it passes them as explicit option values, not
 * `undefined` — `cover` then only stretches that 640x200 drawing to fit via
 * CSS, so at this composer's actual size (~500x32) the wave gets squashed
 * ~6x vertically and reads as a near-invisible hairline. Measuring the
 * container with ResizeObserver and passing real pixel `width`/`height`
 * keeps the draw resolution and the display size 1:1.
 */
export const VoiceWave = ({ volume, className }: { volume: number; className?: string }) => {
  const instanceRef = useRef<SiriWaveInstance | null>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (probeRef.current) setColor(getComputedStyle(probeRef.current).color);

    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!instanceRef.current) return;
    const amplitude = volume > 0.01 ? Math.min(1, volume * 3) : 0;
    const speed = volume > 0.01 ? Math.min(1, 0.25 + volume) : 0.05;
    instanceRef.current.setAmplitude(amplitude);
    instanceRef.current.setSpeed(speed);
  }, [volume]);

  return (
    <div ref={containerRef} className={cn("h-8 flex-1 overflow-hidden", className)} role="img" aria-label="Grabando audio">
      <span ref={probeRef} className="hidden text-muted-foreground" />
      {color && size && size.width > 0 && (
        <ReactSiriwave
          theme="ios9"
          cover
          autostart
          color={color}
          width={size.width}
          height={size.height}
          onInit={(instance) => {
            instanceRef.current = instance;
          }}
        />
      )}
    </div>
  );
};
