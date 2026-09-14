import type { ReactNode } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { formatDeltaLabel } from "@/lib/crm/stats/kpi";
import type { Kpi } from "@/lib/crm/stats/types";
import { cn } from "@/lib/utils";

/**
 * Tarjeta de KPI única de Estadísticas: valor grande + insignia de variación.
 *
 * El color de la insignia sigue una sola regla, sin excepciones por métrica:
 * "up" es éxito y "down" es destructivo, aunque para una tasa de fallo subir
 * sea la mala noticia — invertir el color métrica a métrica obligaría a leer
 * la tarjeta dos veces para saber si el verde es bueno. `kpi` se omite del
 * todo cuando la cifra no tiene periodo anterior con el que compararse.
 */

type Props = {
  label: string;
  value: ReactNode;
  kpi?: Pick<Kpi, "delta" | "trend"> | null;
  /** Texto bajo el valor, p. ej. "compra en los 60 días siguientes". */
  note?: string;
  caption?: string;
  className?: string;
};

const deltaClassName = (kpi: Pick<Kpi, "delta" | "trend">): string => {
  if (kpi.delta === null || kpi.trend === "flat") return "text-muted-foreground";
  return kpi.trend === "up" ? "text-success" : "text-destructive";
};

const KpiCard = ({
  label,
  value,
  kpi,
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
          <span className={cn("font-medium tabular-nums", deltaClassName(kpi))}>
            {formatDeltaLabel(kpi.delta)}
          </span>
          <span className="text-muted-foreground">{caption}</span>
        </p>
      ) : null}
    </CardContent>
  </Card>
);

export default KpiCard;
