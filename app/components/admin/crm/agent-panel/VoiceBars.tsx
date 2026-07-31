"use client";

import { cn } from "@/lib/utils";

const HIGHLIGHT_THRESHOLD = 0.35;

/**
 * Bar-style audio visualizer for the composer's recording state — same
 * visual design as LiveKit's prebuilt Agent Audio Visualizer (bar variant:
 * https://docs.livekit.io/frontends/agents-ui/audio-visualizer/prebuilt/):
 * rounded-full bars, dim at rest, snapping to full color once a bar's band
 * crosses a loudness threshold, each bar driven by its own frequency band
 * (`useSpeechToText`'s `bands`) rather than one shared value.
 *
 * Rebuilt locally instead of installing `@agents-ui/agent-audio-visualizer-bar`
 * — that component's data source is `useMultibandTrackVolume(audioTrack)`
 * from `@livekit/components-react`, which only accepts a LiveKit
 * LocalAudioTrack/RemoteAudioTrack from an actual room connection. This
 * project's mic pipeline is a plain Web Audio AnalyserNode with no LiveKit
 * infrastructure behind it, so pulling in `livekit-client` and
 * `@livekit/components-react` just for their rendering shell wasn't
 * worth the dependency weight — same look, fed from our own `bands` array.
 */
export const VoiceBars = ({ bands, className }: { bands: number[]; className?: string }) => (
  <div className={cn("flex h-8 flex-1 items-center justify-center gap-2", className)} role="img" aria-label="Grabando audio">
    {bands.map((level, i) => (
      <span
        key={i}
        data-highlighted={level > HIGHLIGHT_THRESHOLD}
        className="min-h-2 w-2 shrink-0 rounded-full bg-primary/15 transition-all duration-150 ease-out data-[highlighted=true]:bg-primary"
        style={{ height: `${Math.max(8, Math.round(level * 100))}%` }}
      />
    ))}
  </div>
);
