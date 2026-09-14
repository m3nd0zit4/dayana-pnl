/**
 * Tipos compartidos de Estadísticas. Puros: sin Prisma, sin React, sin
 * `server-only` — los importan tanto las consultas del servidor como la UI.
 */

export type StatsPeriod = "7d" | "30d" | "90d" | "12mo" | "custom";

export type StatsGranularity = "day" | "week" | "month";

export type StatsArea = "ventas" | "embudo" | "contactos" | "contenido";

export type StatsRange = {
  period: StatsPeriod;
  timeZone: string;
  /** Inclusive start instant (UTC Date) = start of first local day. */
  from: Date;
  /** Exclusive end instant (UTC Date) = start of the local day after the last included day. */
  to: Date;
  /** Previous period of identical length immediately before `from`. */
  prevFrom: Date;
  prevTo: Date;
  /** Local date keys "YYYY-MM-DD" of the first and last included day (for labels/inputs). */
  fromKey: string;
  toKey: string;
  granularity: StatsGranularity;
  /** Number of local calendar days included. */
  days: number;
};

export type Kpi = {
  value: number;
  previous: number;
  delta: number | null;
  trend: "up" | "down" | "flat";
};

export type SeriesPoint = { key: string; value: number };
