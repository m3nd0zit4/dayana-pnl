"use client";

import { Button } from "@/app/components/ui/button";

/**
 * Paginación única (regla R10).
 *
 * Había dos estilos: «Cargar más» en notificaciones y bandeja, y un paginador
 * Anterior/Siguiente en el registro de envíos. Gana «Cargar más»: no obliga a
 * recordar en qué página ibas y no pierde el desplazamiento al avanzar.
 *
 * Las listas que hoy se pintan enteras siguen igual — paginarlas es un cambio
 * de la capa de datos, no de presentación.
 */

type Props = {
  onClick: () => void;
  hasMore: boolean;
  loading?: boolean;
};

const CrmLoadMore = ({ onClick, hasMore, loading = false }: Props) => {
  if (!hasMore) return null;

  return (
    <div className="flex justify-center pt-1">
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={loading}
      >
        {loading ? "Cargando…" : "Cargar más"}
      </Button>
    </div>
  );
};

export default CrmLoadMore;
