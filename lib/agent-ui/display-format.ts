/**
 * Number formatting for the display blocks tools return (agent/lib/display.ts).
 * Pure (display-format.test.ts).
 */
import type { DisplayBlock } from "@/agent/lib/display";
import { formatMoneyMinor, minorToMajor } from "@/lib/crm/money";

export type ChartUnit = Extract<DisplayBlock, { kind: "chart" }>["unit"];

/** Full value for tooltips and tables: «1.250.000 COP», «38 %», «12». */
export const formatChartValue = (unit: ChartUnit, value: number): string => {
  if (!Number.isFinite(value)) return "—";
  switch (unit.type) {
    case "money":
      return `${formatMoneyMinor(value, unit.currency)} ${unit.currency}`;
    case "percent":
      return `${(value * 100).toLocaleString("es-CO", { maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0 })} %`;
    default:
      return value.toLocaleString("es-CO", { maximumFractionDigits: 2 });
  }
};

const COMPACT = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });

/** Short value for an axis tick: «1,2 M», «35 %». Money ticks drop the currency. */
export const formatAxisValue = (unit: ChartUnit, value: number): string => {
  if (!Number.isFinite(value)) return "";
  switch (unit.type) {
    case "money":
      return COMPACT.format(minorToMajor(value, unit.currency));
    case "percent":
      return `${Math.round(value * 100)} %`;
    default:
      return COMPACT.format(value);
  }
};

export type DeltaInfo = { text: string; direction: "up" | "down" | "flat" };

/** 0.12 → «+12 %» up; -0.034 → «−3,4 %» down; |delta| < 0.5 % → flat. null when there's no comparison. */
export const deltaInfo = (delta: number | null | undefined): DeltaInfo | null => {
  if (delta == null || !Number.isFinite(delta)) return null;
  const pct = delta * 100;
  if (Math.abs(pct) < 0.5) return { text: "0 %", direction: "flat" };
  const abs = Math.abs(pct).toLocaleString("es-CO", { maximumFractionDigits: Math.abs(pct) < 10 ? 1 : 0 });
  return pct > 0 ? { text: `+${abs} %`, direction: "up" } : { text: `−${abs} %`, direction: "down" };
};

/** Same block twice (two tools returning one series) draws once. */
export const dedupeBlocks = (blocks: readonly DisplayBlock[]): DisplayBlock[] => {
  const seen = new Set<string>();
  const out: DisplayBlock[] = [];
  for (const block of blocks) {
    const key = JSON.stringify(block);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(block);
  }
  return out;
};

/** A table cell, numbers in the Colombian format. */
export const formatCell = (value: string | number): string =>
  typeof value === "number" ? value.toLocaleString("es-CO", { maximumFractionDigits: 2 }) : value;
