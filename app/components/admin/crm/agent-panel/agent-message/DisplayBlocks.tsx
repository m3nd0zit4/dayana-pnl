"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { DisplayBlock } from "@/agent/lib/display";
import { deltaInfo, formatAxisValue, formatCell, formatChartLabel, formatChartValue } from "@/lib/agent-ui/display-format";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/app/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { cn } from "@/lib/utils";

type Kpis = Extract<DisplayBlock, { kind: "kpis" }>;
type Chart = Extract<DisplayBlock, { kind: "chart" }>;
type TableBlock = Extract<DisplayBlock, { kind: "table" }>;

const BlockTitle = ({ children }: { children?: string }) =>
  children ? <p className="mb-2 text-xs font-medium text-muted-foreground">{children}</p> : null;

const KpiTiles = ({ block }: { block: Kpis }) => (
  <figure data-testid="agent-display-kpis">
    <BlockTitle>{block.title}</BlockTitle>
    <div className="grid grid-cols-2 gap-2 @lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {block.items.map((item) => {
        const delta = deltaInfo(item.delta);
        return (
          <div key={item.label} className="min-w-0 rounded-lg border border-border bg-card p-2.5">
            <p className="truncate text-xs text-muted-foreground" title={item.label}>
              {item.label}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold tabular-nums text-foreground" title={item.value}>
              {item.value}
            </p>
            {(delta || item.hint) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                {delta && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 font-medium tabular-nums",
                      delta.direction === "up" && "text-success",
                      delta.direction === "down" && "text-destructive",
                      delta.direction === "flat" && "text-muted-foreground"
                    )}
                  >
                    {delta.direction === "up" && <ArrowUp className="size-3" aria-label="Sube" />}
                    {delta.direction === "down" && <ArrowDown className="size-3" aria-label="Baja" />}
                    {delta.text}
                  </span>
                )}
                {item.hint && <span className="text-muted-foreground">{item.hint}</span>}
              </p>
            )}
          </div>
        );
      })}
    </div>
  </figure>
);

const ChartBlock = ({ block }: { block: Chart }) => {
  const config = { value: { label: block.title, color: "var(--chart-1)" } } satisfies ChartConfig;
  const data = block.points.map((p) => ({ label: formatChartLabel(p.label), value: p.value }));
  const axis = {
    tick: { fill: "var(--muted-foreground)", fontSize: 11 },
    axisLine: false,
    tickLine: false,
  } as const;
  const tooltip = (
    <ChartTooltip
      cursor={{ fill: "var(--muted)", opacity: 0.5 }}
      content={<ChartTooltipContent formatter={(v) => [formatChartValue(block.unit, Number(v)), " "]} />}
    />
  );

  return (
    <figure data-testid="agent-display-chart" data-chart={block.chart}>
      <BlockTitle>{block.title}</BlockTitle>
      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Sin datos para este periodo
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card p-2">
          <ChartContainer config={config} className="aspect-auto h-44 w-full @lg:h-64">
            {block.chart === "line" ? (
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" {...axis} minTickGap={16} />
                <YAxis {...axis} width={40} tickFormatter={(v: number) => formatAxisValue(block.unit, v)} />
                {tooltip}
                <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={data.length <= 12} />
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" {...axis} minTickGap={8} interval="preserveStartEnd" />
                <YAxis {...axis} width={40} tickFormatter={(v: number) => formatAxisValue(block.unit, v)} />
                {tooltip}
                <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            )}
          </ChartContainer>
        </div>
      )}
    </figure>
  );
};

const TableDisplay = ({ block }: { block: TableBlock }) => {
  // Every column but the first holds figures («570.000 COP», «40 %», 3): right-aligned, never wrapped.
  const numeric = block.columns.map((_, col) => col > 0);
  return (
    <figure data-testid="agent-display-table">
      <BlockTitle>{block.title}</BlockTitle>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {block.columns.map((column, i) => (
                <TableHead key={`${i}-${column}`} className={cn("h-8 px-2.5 text-xs", numeric[i] && "text-right")}>
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.map((row, r) => (
              <TableRow key={r}>
                {row.map((cell, c) => (
                  <TableCell
                    key={c}
                    className={cn("px-2.5 py-1.5", numeric[c] ? "text-right tabular-nums" : "whitespace-normal break-words")}
                  >
                    {formatCell(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {block.more ? (
          <p className="border-t border-border px-2.5 py-1.5 text-xs text-muted-foreground">
            {block.more === 1 ? "Y 1 fila más" : `Y ${block.more.toLocaleString("es-CO")} filas más`}
          </p>
        ) : null}
      </div>
    </figure>
  );
};

/** KPI tiles, charts and tables a tool asked to draw, under the reply text. */
export const DisplayBlocks = ({ blocks }: { blocks: DisplayBlock[] }) => {
  if (blocks.length === 0) return null;
  return (
    <div className="@container flex flex-col gap-3" data-testid="agent-display-blocks">
      {blocks.map((block, i) =>
        block.kind === "kpis" ? (
          <KpiTiles key={i} block={block} />
        ) : block.kind === "chart" ? (
          <ChartBlock key={i} block={block} />
        ) : (
          <TableDisplay key={i} block={block} />
        )
      )}
    </div>
  );
};
