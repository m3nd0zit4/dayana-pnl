"use client";

import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";

/**
 * Estado de error único (regla R9).
 *
 * Sustituye cinco formas distintas de decir lo mismo: `<Alert>` con icono, un
 * `<p role="alert">`, un hex escrito a mano (`text-[#b4543a]`), verde esmeralda
 * para el caso contrario y un banner ámbar hecho a medida.
 *
 * El botón de reintentar generaliza lo que solo tenía Terapias. Un error de
 * carga sin salida obliga a recargar la página entera.
 */

type Props = {
  message: string;
  title?: string;
  onRetry?: () => void;
  className?: string;
};

const CrmErrorState = ({
  message,
  title = "No se pudo cargar",
  onRetry,
  className,
}: Props) => (
  <Alert variant="destructive" className={className}>
    <TriangleAlert aria-hidden />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>
      <span>{message}</span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Reintentar
        </Button>
      ) : null}
    </AlertDescription>
  </Alert>
);

export default CrmErrorState;
