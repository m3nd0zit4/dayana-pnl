/**
 * KPI tiles, a chart, a table: what some tools put under `display` in their
 * result. The panel assistant drew them under its reply; it was removed
 * (2026-11) and the MCP server strips `display` before answering (the rest of
 * the result carries the same numbers). Kept as the shape those tools build.
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
