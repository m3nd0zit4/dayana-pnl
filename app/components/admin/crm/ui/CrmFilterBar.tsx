"use client";

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Barra de filtros (regla R10).
 *
 * Cuatro idioms convivían: Contactos tenía una búsqueda **más** un formulario
 * de filtros con botón «Filtrar» que había que pulsar; Pagos, un `<select>`
 * suelto; Bandeja, pastillas hechas a mano; Notificaciones, un control
 * segmentado con un `Select`. Y seis secciones no tenían búsqueda de ninguna
 * clase.
 *
 * Orden fijo: búsqueda, luego filtros, y el recuento a la derecha. Se filtra al
 * escribir, sin botón de enviar — un botón «Filtrar» obliga a un viaje de ida y
 * vuelta para algo que el navegador puede hacer al instante.
 */

type BarProps = {
  children: ReactNode;
  /** Recuento de resultados, alineado a la derecha. */
  count?: ReactNode;
  className?: string;
};

export const CrmFilterBar = ({ children, count, className }: BarProps) => (
  <div
    data-crm-filter-bar=""
    // `items-end`, no `items-center`: los selects llevan etiqueta encima y los
    // controles sin ella (casillas, recuento) tienen que alinearse por abajo,
    // que es donde está la línea de base visual de la fila.
    className={cn("flex flex-wrap items-end gap-3", className)}
  >
    {children}
    {count ? (
      <span className="ml-auto text-xs text-muted-foreground">{count}</span>
    ) : null}
  </div>
);

type SearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export const CrmSearchInput = ({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
}: SearchProps) => (
  <div className={cn("relative w-full sm:w-64", className)}>
    <Search
      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden
    />
    <Input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="pl-8"
    />
    {value ? (
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onChange("")}
        aria-label="Limpiar búsqueda"
        className="absolute top-1/2 right-1 -translate-y-1/2"
      >
        <X aria-hidden />
      </Button>
    ) : null}
  </div>
);

export default CrmFilterBar;
