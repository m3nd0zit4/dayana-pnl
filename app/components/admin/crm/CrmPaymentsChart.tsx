"use client";

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

type Point = { date: string; amountUsd: number };

const chartConfig = {
  amountUsd: {
    label: "Total",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const CrmPaymentsChart = ({ data }: { data: Point[] }) => (
  <Card className="flex h-full min-h-[280px] flex-col">
    <CardHeader>
      <CardTitle>Ingresos (USD)</CardTitle>
      <CardDescription>
        Últimos 14 días · pagos aprobados · COP convertido a la tasa vigente
      </CardDescription>
    </CardHeader>
    <CardContent className="min-h-[220px] flex-1">
      <ChartContainer config={chartConfig} className="h-full w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="crmPayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--secondary)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(v) => [`$${Number(v).toFixed(0)}`, "Total"]}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="amountUsd"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#crmPayGrad)"
          />
        </AreaChart>
      </ChartContainer>
    </CardContent>
  </Card>
);

export default CrmPaymentsChart;
