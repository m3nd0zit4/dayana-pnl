import { cn } from "@/lib/utils";

export type DayanaAiLogoProps = {
  className?: string;
  /** Plays the looping animation; false shows the static frame. Caller decides why (hover, busy, ...). */
  active?: boolean;
};

/**
 * Dayana's ghost mark — replaces the generic Sparkles icon wherever the AI
 * assistant is represented. Two stacked <img>s (static PNG, animated GIF)
 * cross-fade via opacity instead of swapping `src`, so the GIF keeps
 * decoding/looping underneath even while hidden — revealing it never
 * restarts the loop from frame one, it just continues wherever it was.
 */
export const DayanaAiLogo = ({ className, active = false }: DayanaAiLogoProps) => (
  <span className={cn("relative inline-block", className)}>
    <img
      src="/dayana-ai-logo-static.png"
      alt=""
      className={cn("h-full w-full object-contain transition-opacity duration-200", active && "opacity-0")}
    />
    <img
      src="/dayana-ai-logo.gif"
      alt=""
      className={cn(
        "absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-200",
        active && "opacity-100"
      )}
    />
  </span>
);

export default DayanaAiLogo;
