"use client";

import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { cn } from "@/lib/utils";
import SaveIndicator, { type SaveState } from "./SaveIndicator";

/** Lo que pinta el resaltado al llegar desde el buscador. */
export const SETTING_ANCHOR_CLASS =
  "scroll-mt-44 rounded-xl transition-shadow duration-500 data-[highlight=true]:ring-2 data-[highlight=true]:ring-[#00a884] data-[highlight=true]:ring-offset-2 data-[highlight=true]:ring-offset-background";

/** La explicación larga, detrás de un «?»: la pantalla queda limpia. */
export const InfoTip = ({ children, label = "Más información" }: { children: ReactNode; label?: string }) => (
  <Popover>
    <PopoverTrigger
      aria-label={label}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
    >
      <CircleHelp className="size-3.5" aria-hidden />
    </PopoverTrigger>
    <PopoverContent side="top" className="w-72 text-xs leading-relaxed text-muted-foreground">
      {children}
    </PopoverContent>
  </Popover>
);

/** Un envoltorio con `id` para bloques que no son una fila (tarjetas reutilizadas). */
export const SettingAnchor = ({ id, children, className }: { id: string; children: ReactNode; className?: string }) => (
  <div id={id} className={cn(SETTING_ANCHOR_CLASS, className)}>
    {children}
  </div>
);

/**
 * Una fila de ajuste: nombre, una línea de ayuda como mucho y el control a la
 * derecha (debajo en el teléfono). `stacked` pone el control debajo siempre,
 * para textos largos y editores.
 */
const SettingRow = ({
  id,
  label,
  help,
  info,
  state,
  htmlFor,
  layout = "inline",
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  info?: ReactNode;
  state?: SaveState;
  htmlFor?: string;
  /** `row`: el control siempre a la derecha, también en el teléfono (interruptores). */
  layout?: "inline" | "stacked" | "row";
  children: ReactNode;
  className?: string;
}) => (
  <div
    id={id}
    className={cn(
      SETTING_ANCHOR_CLASS,
      "flex flex-col gap-3 px-4 py-4",
      layout === "inline" && "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
      layout === "row" && "flex-row items-center justify-between gap-4 sm:gap-6",
      className
    )}
  >
    <div className="min-w-0 flex-1 space-y-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {info && <InfoTip>{info}</InfoTip>}
        <SaveIndicator state={state} />
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
    <div className={cn("min-w-0", layout === "stacked" ? "w-full" : layout === "row" ? "shrink-0" : "sm:shrink-0")}>{children}</div>
  </div>
);

/** Un grupo de filas bajo un título corto. */
export const SettingsGroup = ({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn("space-y-2", className)}>
    <div className="flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
    <div className="divide-y divide-border overflow-visible rounded-xl border border-border bg-card text-card-foreground">
      {children}
    </div>
  </section>
);

export default SettingRow;
