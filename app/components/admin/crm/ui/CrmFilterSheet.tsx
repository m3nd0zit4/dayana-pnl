"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import { useIsMobile } from "@/app/hooks/use-mobile";

type Props = {
  /** Filtros con un valor distinto del de por defecto. Se muestra en el botón. */
  activeCount: number;
  /** Vuelve todos los filtros de la hoja a su valor por defecto. */
  onClear: () => void;
  /** Los controles de filtro. Se aplican al cambiar, sin botón de enviar (R10). */
  children: ReactNode;
  /** Acciones sobre el resultado filtrado, p. ej. exportar. */
  footer?: ReactNode;
  description?: string;
};

/**
 * Los filtros que no se usan a diario (regla R10).
 *
 * Pagos tenía siete filtros y un botón de exportar siempre a la vista, y
 * Contactos cuatro: una barra que pedía decidir sobre todo antes de ver nada.
 * La barra se queda con la búsqueda y como mucho dos filtros —los que abre
 * «Para hoy»—; el resto vive aquí, detrás de un botón que dice cuántos hay
 * puestos, para que un filtro activo nunca pase desapercibido.
 *
 * En el móvil la hoja sale desde abajo, al alcance del pulgar; en el
 * escritorio, desde la derecha, sin tapar la lista.
 */
const CrmFilterSheet = ({
  activeCount,
  onClear,
  children,
  footer,
  description = "Se aplican al momento.",
}: Props) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={activeCount > 0 ? `Filtros (${activeCount} activos)` : "Filtros"}
      >
        <SlidersHorizontal aria-hidden />
        Filtros
        {activeCount > 0 ? (
          <Badge variant="secondary" className="ml-0.5 tabular-nums">
            {activeCount}
          </Badge>
        ) : null}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={isMobile ? "max-h-[85dvh] overflow-y-auto rounded-t-2xl" : "overflow-y-auto"}
        >
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4">{children}</div>

          <SheetFooter className="gap-2">
            {footer}
            <Button
              type="button"
              variant="ghost"
              onClick={onClear}
              disabled={activeCount === 0}
            >
              Limpiar filtros
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default CrmFilterSheet;
