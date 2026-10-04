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
          ? // Cada celda mide al menos lo que su texto (`minmax(max-content,1fr)`)
            // y, si no caben, la fila se desplaza dentro de sí misma: nunca se
            // pisan. Desde `sm`, cada pestaña del ancho de su etiqueta.
            "grid w-full auto-cols-[minmax(max-content,1fr)] grid-flow-col overflow-x-auto overflow-y-hidden group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-fit sm:max-w-full sm:gap-1 sm:group-data-horizontal/tabs:h-8"
          : undefined
      }
    >
      {segments.map((seg) => {
        const Icon = seg.icon;
        const fullLabel = seg.count != null ? `${seg.label} (${seg.count})` : seg.label;
        if (!mobileGrid) {
          return (
            <TabsTrigger key={seg.id} value={seg.id} aria-label={fullLabel}>
              {fullLabel}
            </TabsTrigger>
          );
        }
        return (
          <TabsTrigger
            key={seg.id}
            value={seg.id}
            // Nombre accesible explícito: la etiqueta visible cambia entre el
            // teléfono y el escritorio, y la otra queda en `display: none`.
            aria-label={fullLabel}
            // `min-h-11`: en el teléfono cada celda es un toque de pulgar (≥ 40 px).
            // Desde `sm`, `flex-none` y `min-w-max`: con `flex-1` y `min-w-0`
            // todas medían lo mismo y «Inscritas (159)» se montaba sobre «WhatsApp».
            className="h-auto min-h-11 min-w-0 flex-col gap-0.5 px-1 py-1.5 text-[11px] leading-tight tracking-tight sm:h-[calc(100%-1px)] sm:min-h-0 sm:min-w-max sm:flex-none sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0.5 sm:text-sm sm:tracking-normal"
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
