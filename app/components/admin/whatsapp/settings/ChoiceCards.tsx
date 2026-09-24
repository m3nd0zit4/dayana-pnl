"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChoiceOption<T extends string> = {
  id: T;
  label: string;
  /** Una línea como mucho. */
  hint?: string;
  icon?: LucideIcon;
};

/**
 * La única forma de elegir una opción entre varias en Ajustes de WhatsApp.
 *
 * - `cards`: tarjetas con título y una línea (para decisiones que se leen).
 * - `segmented`: botones pegados (para cambiar rápido, p. ej. el modo).
 */
const ChoiceCards = <T extends string>({
  value,
  onChange,
  options,
  variant = "cards",
  columns = 2,
  disabled,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ChoiceOption<T>[];
  variant?: "cards" | "segmented";
  columns?: 2 | 3;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) => {
  if (variant === "segmented") {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn("inline-flex w-full rounded-lg border border-border bg-muted/50 p-0.5 sm:w-auto", className)}
      >
        {options.map((o) => {
          const on = o.id === value;
          const Icon = o.icon;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.hint}
              disabled={disabled}
              onClick={() => !on && onChange(o.id)}
              className={cn(
                "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] disabled:opacity-50 sm:flex-none",
                on
                  ? "bg-[#00a884] text-white shadow-sm hover:bg-[#008069]"
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              )}
            >
              {Icon && <Icon className="size-3.5" aria-hidden />}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2", className)}
    >
      {options.map((o) => {
        const on = o.id === value;
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(o.id)}
            className={cn(
              "relative flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] disabled:opacity-50",
              on
                ? "border-[#00a884] bg-[#00a884]/10 dark:bg-[#00a884]/15"
                : "border-border bg-card hover:border-foreground/30"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                on ? "border-[#00a884]" : "border-muted-foreground/40"
              )}
            >
              {on && <span className="size-2 rounded-full bg-[#00a884]" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {Icon && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
                {o.label}
              </span>
              {o.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default ChoiceCards;
