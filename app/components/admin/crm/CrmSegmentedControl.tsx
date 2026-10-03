"use client";

import type { LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";

type Segment<T extends string> = {
  id: T;
  label: string;
  count?: number;
  /** Icono, para la rejilla del móvil (`mobileGrid`). */
  icon?: LucideIcon;
  /** Etiqueta corta para el móvil. */
  shortLabel?: string;
};

type Props<T extends string> = {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  "aria-label"?: string;
  /**
   * En un teléfono las pestañas ocupan todo el ancho, una celda por pestaña
   * con su icono encima de la etiqueta corta: así caben seis en 390 px sin
   * cortar ninguna. Desde `sm`, la fila de siempre.
   */
  mobileGrid?: boolean;
};

const CrmSegmentedControl = <T extends string>({
  segments,
  value,
  onChange,
  className = "",
  "aria-label": ariaLabel = "Secciones",
  mobileGrid = false,
}: Props<T>) => (
  <Tabs
    value={value}
    onValueChange={(next) => {
      if (typeof next === "string") onChange(next as T);
    }}
    className={className}
  >
    <TabsList
      aria-label={ariaLabel}
      className={
        mobileGrid
          ? "grid w-full auto-cols-fr grid-flow-col group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-fit sm:group-data-horizontal/tabs:h-8"
          : undefined
      }
    >
      {segments.map((seg) => {
        const Icon = seg.icon;
        if (!mobileGrid) {
          return (
            <TabsTrigger key={seg.id} value={seg.id}>
              {seg.count != null ? `${seg.label} (${seg.count})` : seg.label}
            </TabsTrigger>
          );
        }
        return (
          <TabsTrigger
            key={seg.id}
            value={seg.id}
            className="h-auto min-w-0 flex-col gap-0.5 px-0 py-1.5 text-[11px] leading-tight tracking-tight sm:h-[calc(100%-1px)] sm:flex-row sm:gap-1.5 sm:px-1.5 sm:py-0.5 sm:text-sm sm:tracking-normal"
          >
            {Icon ? (
              <span className="relative sm:hidden">
                <Icon aria-hidden className="size-4" />
                {seg.count ? (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 -right-3 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] leading-4 font-semibold text-primary-foreground tabular-nums"
                  >
                    {seg.count > 99 ? "99+" : seg.count}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span data-tab-label="" className="max-w-full truncate sm:hidden">
              {seg.shortLabel ?? seg.label}
              {!Icon && seg.count != null ? ` (${seg.count})` : ""}
              {/* El número del globo, para quien no lo ve. */}
              {Icon && seg.count ? <span className="sr-only"> ({seg.count})</span> : null}
            </span>
            <span data-tab-label="" className="hidden sm:inline">
              {seg.count != null ? `${seg.label} (${seg.count})` : seg.label}
            </span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  </Tabs>
);

export default CrmSegmentedControl;
