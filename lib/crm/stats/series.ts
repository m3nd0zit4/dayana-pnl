import { bucketKeyForDateKey } from "./range";
import type { SeriesPoint, StatsGranularity } from "./types";

/**
 * Serie continua sobre las claves del rango: SQL solo devuelve cubetas con
 * datos, y un gráfico con huecos omitidos engaña (une puntos no contiguos).
 * Claves ausentes → 0; filas fuera del rango se ignoran; claves repetidas se
 * suman (p. ej. una fila por moneda o proveedor en la misma cubeta).
 */
export function fillSeries(
  keys: string[],
  rows: { key: string; value: number }[]
): SeriesPoint[] {
  const totals = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const row of rows) {
    const current = totals.get(row.key);
    if (current === undefined) continue;
    totals.set(row.key, current + row.value);
  }
  return keys.map((key) => ({ key, value: totals.get(key) ?? 0 }));
}

/**
 * Agrupa filas diarias (fecha local "YYYY-MM-DD") en cubetas de la
 * granularidad dada, ordenadas por clave. Permite pedir a SQL siempre por día
 * y reagrupar en JS con la misma semana ISO que usa `bucketKeys`.
 */
export function sumByBucket(
  rows: { dateKey: string; value: number }[],
  granularity: StatsGranularity
): { key: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = bucketKeyForDateKey(row.dateKey, granularity);
    totals.set(key, (totals.get(key) ?? 0) + row.value);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key, value }));
}
