"use client";

import { cn } from "@/lib/utils";

/**
 * Volume-reactive waveform shown in place of the composer's text field while
 * dictation is recording — see `useSpeechToText`'s `levels` (0..1 per bar,
 * resampled from the mic on every animation frame). Flat when the speaker is
 * silent; that's intentional, not a bug — recording only stops on an explicit
 * stop/send, not on silence.
 */
export const VoiceBars = ({ levels, className }: { levels: number[]; className?: string }) => (
  <div className={cn("flex h-4 items-center justify-center gap-1", className)} role="img" aria-label="Grabando audio">
    {levels.map((level, i) => (
      <span
        key={i}
        className="w-1 rounded-full bg-muted-foreground/60 transition-[height] duration-100"
        style={{ height: `${Math.round(Math.max(0.15, level) * 100)}%` }}
      />
    ))}
  </div>
);
