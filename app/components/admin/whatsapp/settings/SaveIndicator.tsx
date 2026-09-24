"use client";

import { Check, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState =
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; error: string; retry?: () => void };

/**
 * «Guardando…» → «Guardado ✓» junto al ajuste, o el error con «Reintentar».
 * Cada ajuste se guarda solo: esta es la única confirmación que hace falta.
 */
const SaveIndicator = ({ state, className }: { state?: SaveState; className?: string }) => (
  <span aria-live="polite" className={cn("inline-flex min-h-4 items-center gap-1 text-xs", className)}>
    {state?.status === "saving" && (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Guardando…
      </span>
    )}
    {state?.status === "saved" && (
      <span className="inline-flex items-center gap-1 font-medium text-[#008069] dark:text-[#00a884]">
        <Check className="size-3" aria-hidden /> Guardado
      </span>
    )}
    {state?.status === "error" && (
      <span className="inline-flex flex-wrap items-center gap-1 text-destructive">
        {state.error}
        {state.retry && (
          <button
            type="button"
            onClick={state.retry}
            className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
          >
            <RotateCcw className="size-3" aria-hidden /> Reintentar
          </button>
        )}
      </span>
    )}
  </span>
);

export default SaveIndicator;
