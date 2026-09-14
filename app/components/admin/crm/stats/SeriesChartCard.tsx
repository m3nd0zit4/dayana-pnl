"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/app/components/ui/chart";
import type { SeriesPoint, StatsGranularity } from "@/lib/crm/stats/types";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";

const MONTH_FMT = new Intl.DateTimeFormat("es-CO", { month: "short", timeZone: "UTC" });

/** "14 sep" (día), "sem. 14 sep" (semana, clave = lunes) o "sep 2026" (mes). */
const formatBucketLabel = (key: string, granularity: StatsGranularity): string => {
  if (granularity === "month") {
    const [year, month] = key.split("-").map(Number);
    const label = MONTH_FMT.format(new Date(Date.UTC(year, month - 1, 1))).replace(/\.$/, "");
    return `${label} ${year}`;
  }
  const [year, month, day] = key.split("-").map(Number);
  const label = `${day} ${MONTH_FMT.format(new Date(Date.UTC(year, month - 1, day))).replace(/\.$/, "")}`;
  return granularity === "week" ? `sem. ${label}` : label;
};

type Props = {
  title: string;
  description?: string;
  points: SeriesPoint[];
  granularity: StatsGranularity;
  /** Nombre de la serie en la leyenda y el tooltip. */
  seriesLabel?: string;
  valueFormatter?: (value: number) => string;
  color?: string;
  className?: string;
};

/**
 * Área temporal sobre `SeriesPoint[]`, reutilizable para cualquier serie de
 * Estadísticas (ingresos, contactos nuevos, registros de webinar…). Para
 * seriesByCurrency el llamador pinta una tarjeta por moneda: sumarlas en un
 * solo eje mezclaría pesos y dólares.
 */
const SeriesChartCard = ({
  title,
  description,
  points,
  granularity,
  seriesLabel = "Total",
  valueFormatter = (v) => v.toLocaleString("es-CO"),
  color = "var(--chart-1)",
  className,
}: Props) => {
  // Id único por instancia: dos tarjetas en la misma página (una por moneda)
  // no pueden compartir el id del degradado, o la segunda referencia al
  // primero vía `url(#…)` y el relleno sale del color equivocado.
  const gradientId = `statsGrad-${useId().replace(/:/g, "")}`;
  const isEmpty = points.every((p) => p.value === 0);
  const data = points.map((p) => ({
    key: p.key,
    label: formatBucketLabel(p.key, granularity),
    value: p.value,
  }));

  const chartConfig = {
    value: { label: seriesLabel, color },
  } satisfies ChartConfig;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="min-h-[220px]">
        {isEmpty ? (
          <CrmEmptyState title="Sin datos en este periodo" className="py-6" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(v) => [valueFormatter(Number(v)), seriesLabel]}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default SeriesChartCard;
