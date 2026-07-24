import { cn } from "@/lib/utils";

/**
 * CSS-only stand-in for the scaffold's `motion`-powered Shimmer — this project
 * already uses gsap for animation, so a second animation library for one
 * loading-text effect isn't worth it. Same visual idea (sweeping gradient
 * text), pure Tailwind + a local keyframe.
 */
export const Shimmer = ({ children, className }: { children: string; className?: string }) => (
  <span
    className={cn(
      "relative inline-block animate-[shimmer-sweep_2s_linear_infinite] bg-[length:250%_100%] bg-clip-text text-transparent",
      "bg-[linear-gradient(90deg,var(--color-muted-foreground)_40%,var(--color-foreground)_50%,var(--color-muted-foreground)_60%)]",
      className
    )}
  >
    {children}
  </span>
);
