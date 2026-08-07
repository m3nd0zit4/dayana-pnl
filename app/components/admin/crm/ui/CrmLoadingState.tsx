import { Skeleton } from "@/app/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Estado de carga único (regla R9).
 *
 * Antes solo la bandeja de entrada usaba `Skeleton`; el resto del CRM pintaba
 * la cadena «Cargando…», que además salta de layout en cuanto llegan los datos.
 */

type Props = {
  rows?: number;
  variant?: "list" | "card" | "inline";
  className?: string;
};

const CrmLoadingState = ({
  rows = 4,
  variant = "list",
  className,
}: Props) => {
  if (variant === "inline") {
    return (
      <Skeleton
        className={cn("h-5 w-32", className)}
        aria-label="Cargando"
      />
    );
  }

  return (
    <div
      data-crm-loading=""
      className={cn(
        variant === "list" ? "divide-y divide-border" : "space-y-3",
        className,
      )}
      aria-busy="true"
      aria-label="Cargando"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-3",
            variant === "list" ? "px-4 py-3.5" : "rounded-lg border p-4",
          )}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-7 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
};

export default CrmLoadingState;
