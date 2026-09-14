import type { BreakdownRow, FunnelStep } from "./dto";
import { ratio } from "./kpi";

type BreakdownInput = {
  key: string;
  value: number;
  label?: string;
  currency?: string;
};

/**
 * Filas de desglose con su proporción.
 *
 * La proporción se calcula dentro de cada moneda: un 40 % de los pesos y un
 * 40 % de los dólares son cosas distintas, y mezclar escalas (COP en pesos,
 * USD en centavos) daría porcentajes sin sentido. Orden: por moneda y, dentro
 * de cada una, de mayor a menor.
 */
export function toBreakdownRows(
  rows: BreakdownInput[],
  opts: { limit?: number; labelFor?: (key: string) => string } = {},
): BreakdownRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const group = row.currency ?? "";
    totals.set(group, (totals.get(group) ?? 0) + row.value);
  }

  const out: BreakdownRow[] = rows
    .map((row) => {
      const item: BreakdownRow = {
        key: row.key,
        label: row.label ?? opts.labelFor?.(row.key) ?? row.key,
        value: row.value,
        share: ratio(row.value, totals.get(row.currency ?? "") ?? 0),
      };
      if (row.currency) item.currency = row.currency;
      return item;
    })
    .sort(
      (a, b) =>
        (a.currency ?? "").localeCompare(b.currency ?? "") ||
        b.value - a.value ||
        a.label.localeCompare(b.label, "es"),
    );

  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Pasos de un embudo con la conversión desde el anterior y desde el primero. */
export function toFunnelSteps(
  steps: { key: string; label: string; count: number }[],
): FunnelStep[] {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, i) => ({
    ...step,
    conversionFromPrevious: i === 0 ? null : ratio(step.count, steps[i - 1].count),
    conversionFromStart: i === 0 ? null : ratio(step.count, first),
  }));
}
