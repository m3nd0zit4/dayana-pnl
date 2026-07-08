"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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

type Point = { label: string; count: number };

const chartConfig = {
  count: {
    label: "Servicios",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig;

const CrmPipelineChart = ({ data }: { data: Point[] }) => (
  <Card className="flex h-full min-h-[280px] flex-col">
    <CardHeader>
      <CardTitle>Pipeline</CardTitle>
      <CardDescription>Servicios por estado</CardDescription>
    </CardHeader>
    <CardContent className="min-h-[220px] flex-1">
      <ChartContainer config={chartConfig} className="h-full w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={100}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--chart-5)" radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ChartContainer>
    </CardContent>
  </Card>
);

export default CrmPipelineChart;
