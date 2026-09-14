import type { Kpi } from "./types";

/** Por debajo de ±0,5 % la variación se muestra como estable. */
const FLAT_BAND = 0.005;

/** Redondeo a 4 decimales sin devolver `-0`. */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000 + 0;

/**
 * KPI con variación frente al periodo anterior.
 *
 * `delta` es una razón (0,125 = +12,5 %). Con periodo anterior en 0 no hay
 * porcentaje significativo: `delta` es null y la tendencia solo dice si hubo
 * algo ("up") o nada ("flat"). El denominador usa `|previous|` para que el
 * signo refleje la dirección real también con valores netos negativos
 * (idéntico a `/previous` en conteos e ingresos, que nunca son negativos).
 */
export function withDelta(value: number, previous: number): Kpi {
  if (previous === 0) {
    return { value, previous, delta: null, trend: value > 0 ? "up" : "flat" };
  }
  const delta = round4((value - previous) / Math.abs(previous));
  const trend = Math.abs(delta) < FLAT_BAND ? "flat" : delta > 0 ? "up" : "down";
  return { value, previous, delta, trend };
}

/** Razón redondeada a 4 decimales; null si no hay denominador. */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return round4(numerator / denominator);
}

const MINUS = "−";

/**
 * Etiqueta de variación en es-CO: "+12,5 %", "−3 %", "0 %" o "—" sin dato.
 * Un decimal como máximo; sin decimales si el porcentaje es entero. Se usa el
 * signo menos tipográfico (U+2212) para que no se confunda con un guion.
 */
export function formatDeltaLabel(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const pct = Math.round(delta * 1000) / 10 + 0;
  const abs = Math.abs(pct).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  const sign = pct > 0 ? "+" : pct < 0 ? MINUS : "";
  return `${sign}${abs} %`;
}
