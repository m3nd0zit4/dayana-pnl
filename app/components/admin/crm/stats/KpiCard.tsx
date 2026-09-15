import type { ReactNode } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { formatDeltaLabel } from "@/lib/crm/stats/kpi";
import type { Kpi } from "@/lib/crm/stats/types";
import { cn } from "@/lib/utils";

/**
 * Tarjeta de KPI única de Estadísticas: valor grande + insignia de variación.
 *
 * El color dice si la variación es buena noticia, no hacia dónde va: verde es
 * bueno y rojo es malo. En casi todas las cifras subir es bueno, pero en una
 * tasa de fallo bajar es lo que se quiere — pintar esa bajada en rojo hacía
 * leer una mejora como un problema. Por eso `positiveWhen`, que por defecto
 * es "up". `kpi` se omite del todo cuando la cifra no tiene periodo anterior
 * con el que compararse.
 */

type Props = {
  label: string;
  value: ReactNode;
  kpi?: Pick<Kpi, "delta" | "trend"> | null;
  /** Hacia dónde es buena noticia que se mueva la cifra. */
  positiveWhen?: "up" | "down";
  /** Texto bajo el valor, p. ej. "compra en los 60 días siguientes". */
  note?: string;
  caption?: string;
  className?: string;
};

const deltaClassName = (
  kpi: Pick<Kpi, "delta" | "trend">,
  positiveWhen: "up" | "down",
): string => {
  if (kpi.delta === null || kpi.trend === "flat") return "text-muted-foreground";
  return kpi.trend === positiveWhen ? "text-success" : "text-destructive";
};

const KpiCard = ({
  label,
  value,
  kpi,
  positiveWhen = "up",
  note,
  caption = "vs periodo anterior",
  className,
}: Props) => (
  <Card className={className}>
    <CardContent className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {kpi ? (
        <p className="flex flex-wrap items-baseline gap-1.5 text-xs">
          <span className={cn("font-medium tabular-nums", deltaClassName(kpi, positiveWhen))}>
            {formatDeltaLabel(kpi.delta)}
          </span>
          <span className="text-muted-foreground">{caption}</span>
        </p>
      ) : null}
    </CardContent>
  </Card>
);

export default KpiCard;
