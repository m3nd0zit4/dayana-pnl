/**
 * What a tool result can ask the panel to draw: KPI tiles, a chart, a table.
 * Pure data, imported by tools (server) and the panel (client).
 *
 * A tool puts these under `display` in its result. The model reads the rest
 * of the result; the panel draws `display` under the reply, so numbers come
 * out as a table or a chart instead of a paragraph of figures the model had to
 * retype (and could retype wrong).
 */

export type DisplayKpi = {
  label: string;
  /** Already formatted for reading: «1.250.000 COP», «38 %», «12». */
  value: string;
  /** Change vs the previous period, as a fraction (0.12 = +12 %). */
  delta?: number | null;
  hint?: string;
};

export type DisplayPoint = { label: string; value: number };

export type DisplayBlock =
  | { kind: "kpis"; title?: string; items: DisplayKpi[] }
  | {
      kind: "chart";
      chart: "bar" | "line";
      title: string;
      /** How to read `value`: plain count, a currency (minor units) or a 0–1 share. */
      unit: { type: "count" } | { type: "money"; currency: string } | { type: "percent" };
      points: DisplayPoint[];
    }
  | {
      kind: "table";
      title: string;
      columns: string[];
      rows: (string | number)[][];
      /** Rows left out because the table was cut. */
      more?: number;
    };

export const isDisplayBlock = (value: unknown): value is DisplayBlock => {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "kpis" || kind === "chart" || kind === "table";
};

/** Pulls `display` blocks out of an arbitrary tool output. */
export const displayBlocksOf = (output: unknown): DisplayBlock[] => {
  if (!output || typeof output !== "object") return [];
  const display = (output as { display?: unknown }).display;
  return Array.isArray(display) ? display.filter(isDisplayBlock) : [];
};
