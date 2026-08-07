import type { ReactNode } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Lista de filas del CRM (regla R8).
 *
 * El panel tenía dos formas incompatibles de pintar una lista: una `Card` con
 * `divide-y` y filas flex (unas diez secciones), y la primitiva `<Table>` (tres
 * archivos). Códigos promocionales llegaba a enviar **las dos**, una `<Table>`
 * para `lg` y una lista duplicada para móvil — el mismo contenido mantenido dos
 * veces.
 *
 * Gana el idiom de `Card` + `divide-y`, porque ya era mayoritario y porque una
 * fila flex se reordena en móvil y una celda de tabla no. `columns` conserva
 * las columnas alineadas en pantallas anchas sin necesitar un `<table>`.
 *
 * `<Table>` sobrevive solo donde hay datos de verdad tabulares y ninguna
 * versión móvil que mantener aparte.
 */

type ListProps = {
  children: ReactNode;
  className?: string;
};

export const CrmDataList = ({ children, className }: ListProps) => (
  <Card className={cn("overflow-hidden py-0", className)}>
    <CardContent className="divide-y divide-border p-0">{children}</CardContent>
  </Card>
);

type RowProps = {
  children: ReactNode;
  /** Grupo de acciones, siempre a la derecha. Usar `CrmRowActions`. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Una fila. El contenido se reparte con flex y las anchuras de columna las pone
 * quien la usa (`w-32`, `lg:w-40`…), que es lo que permite que en móvil las
 * celdas se apilen solas sin una media query aparte.
 */
export const CrmDataListRow = ({ children, actions, className }: RowProps) => (
  <div
    data-crm-row=""
    className={cn(
      "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5",
      className,
    )}
  >
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
      {children}
    </div>
    {actions ? <div className="shrink-0">{actions}</div> : null}
  </div>
);

type HeaderProps = {
  children: ReactNode;
  className?: string;
};

/** Fila de encabezados, oculta en móvil (donde las filas se apilan). */
export const CrmDataListHeader = ({ children, className }: HeaderProps) => (
  <div
    className={cn(
      "hidden items-center gap-x-4 bg-muted/40 px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase lg:flex",
      className,
    )}
  >
    {children}
  </div>
);

export default CrmDataList;
