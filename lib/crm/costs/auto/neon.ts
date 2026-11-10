import {
  autoGet,
  env,
  monthKeyUtc,
  monthStartUtc,
  num,
  parseJson,
  rangeEndUtc,
  type AutoCollector,
  type AutoContext,
  type AutoMonth,
} from "./types";

/**
 * Neon: la base de datos. Se cobra por uso, sin cuota fija, y no hay una API
 * de facturas: lo que sí hay es el consumo (`/consumption_history/v2/projects`)
 * y la fórmula con la que Neon lo convierte en dinero
 * (neon.com/docs/introduction/usage-calculations, leída el 9-nov-2026). El
 * resultado «se parece mucho» a la factura, dice Neon; por eso va como
 * aproximado.
 *
 * Claves: `NEON_API_KEY` (la pega la dueña), `NEON_ORG_ID` y, para no contar
 * otros proyectos de la misma organización, `NEON_PROJECT_ID`.
 *
 * Los meses cerrados se piden con granularidad mensual y el mes en curso con
 * diaria: con mensual, el `to` se redondea al inicio del mes y el mes actual
 * no vendría.
 */

const API = "https://console.neon.tech/api/v2/consumption_history/v2/projects";

const METRICS = [
  "compute_unit_seconds",
  "root_branch_bytes_month",
  "child_branch_bytes_month",
  "instant_restore_bytes_month",
  "snapshot_storage_bytes_month",
  "public_network_transfer_bytes",
  "extra_branches_month",
] as const;
type Metric = (typeof METRICS)[number];

/** Dólares por unidad de facturación, por plan. */
const RATES: Record<string, { compute: number }> = {
  launch: { compute: 0.106 },
  agent: { compute: 0.106 },
  scale: { compute: 0.222 },
  enterprise: { compute: 0.222 },
};
const STORAGE_GB_MONTH = 0.35;
const RESTORE_GB_MONTH = 0.2;
const SNAPSHOT_GB_MONTH = 0.09;
const TRANSFER_GB = 0.1;
const TRANSFER_FREE_GB = 500;
const EXTRA_BRANCH_MONTH = 1.5;
/** Ramas hijas incluidas por proyecto (10 − la raíz en Launch; 25 − 1 en el resto). */
const FREE_CHILD_BRANCHES: Record<string, number> = { launch: 9, agent: 24, scale: 24, enterprise: 24 };
/** Neon factura con un mes fijo de 744 horas. */
const BILLING_HOURS = 744;
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const GB = 1_000_000_000;

export type NeonUsage = Partial<Record<Metric, number>> & { plan: string; hours: number };

const planOf = (usage: NeonUsage): string => (RATES[usage.plan] ? usage.plan : "launch");

/**
 * Lo que cuestan las ramas que pasan de las incluidas. Neon cuenta TODAS las
 * ramas hijas por hora; se le restan las incluidas del plan por cada hora del
 * tramo. Es lo que más sorprende en la factura: cada rama de respaldo que no
 * se borra cuesta 1,50 USD al mes. Puro.
 */
export const neonBranchUsd = (usage: NeonUsage): number => {
  const billableBranchHours = Math.max(
    0,
    (usage.extra_branches_month ?? 0) - (FREE_CHILD_BRANCHES[planOf(usage)] ?? 9) * usage.hours,
  );
  return (billableBranchHours / BILLING_HOURS) * EXTRA_BRANCH_MONTH;
};

/** Dólares de un tramo de consumo de un proyecto. Puro. */
export const neonCostUsd = (usage: NeonUsage): number => {
  const cuHours = (usage.compute_unit_seconds ?? 0) / 3600;
  const storageGb = ((usage.root_branch_bytes_month ?? 0) + (usage.child_branch_bytes_month ?? 0)) / GB;
  return (
    cuHours * RATES[planOf(usage)].compute +
    storageGb * STORAGE_GB_MONTH +
    ((usage.instant_restore_bytes_month ?? 0) / GB) * RESTORE_GB_MONTH +
    ((usage.snapshot_storage_bytes_month ?? 0) / GB) * SNAPSHOT_GB_MONTH +
    neonBranchUsd(usage)
  );
};

type NeonResponse = {
  projects?: {
    project_id?: string;
    periods?: {
      period_plan?: string;
      /** Cuándo empezó (y terminó) el periodo de facturación: el plan pudo contratarse a mitad de mes. */
      period_start?: string;
      period_end?: string;
      consumption?: {
        timeframe_start?: string;
        timeframe_end?: string;
        metrics?: { metric_name?: string; value?: number }[];
      }[];
    }[];
  }[];
  pagination?: { cursor?: string };
};

type MonthTotal = {
  usd: number;
  cuHours: number;
  storageGb: number;
  /** De `usd`, lo que es de ramas de más. */
  branchUsd: number;
  transferByProject: Map<string, number>;
};

const time = (iso: string | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

/** Suma una respuesta de consumo por mes. Puro. */
export const sumNeonConsumption = (data: NeonResponse, into: Map<string, MonthTotal> = new Map()): Map<string, MonthTotal> => {
  for (const project of data.projects ?? []) {
    for (const period of project.periods ?? []) {
      for (const frame of period.consumption ?? []) {
        const startMs = time(frame.timeframe_start);
        if (startMs == null) continue;
        const start = new Date(startMs);
        const endMs = time(frame.timeframe_end) ?? startMs + 24 * 3_600_000;
        // Las horas que el tramo estuvo de verdad dentro del periodo: un plan
        // contratado el día 16 no tiene 744 horas de ramas incluidas ese mes,
        // y contarlas enteras escondería casi todo el cobro por ramas.
        const from = Math.max(startMs, time(period.period_start) ?? startMs);
        const to = Math.min(endMs, time(period.period_end) ?? endMs);
        const hours = to > from ? (to - from) / 3_600_000 : (endMs - startMs) / 3_600_000;
        const usage: NeonUsage = { plan: period.period_plan ?? "launch", hours };
        for (const metric of frame.metrics ?? []) {
          if ((METRICS as readonly string[]).includes(metric.metric_name ?? "")) {
            usage[metric.metric_name as Metric] = Number(metric.value) || 0;
          }
        }
        const month = monthKeyUtc(start);
        const total = into.get(month) ?? { usd: 0, cuHours: 0, storageGb: 0, branchUsd: 0, transferByProject: new Map() };
        total.usd += neonCostUsd(usage);
        total.branchUsd += neonBranchUsd(usage);
        total.cuHours += (usage.compute_unit_seconds ?? 0) / 3600;
        total.storageGb += ((usage.root_branch_bytes_month ?? 0) + (usage.child_branch_bytes_month ?? 0)) / GB;
        const id = project.project_id ?? "";
        total.transferByProject.set(
          id,
          (total.transferByProject.get(id) ?? 0) + (usage.public_network_transfer_bytes ?? 0) / GB,
        );
        into.set(month, total);
      }
    }
  }
  return into;
};

/** La cifra del mes: lo sumado más el tráfico que pase de lo incluido por proyecto. Puro. */
export const neonMonth = (total: MonthTotal): AutoMonth => {
  let transferUsd = 0;
  for (const gb of total.transferByProject.values()) transferUsd += Math.max(0, gb - TRANSFER_FREE_GB) * TRANSFER_GB;
  return {
    usdCents: (total.usd + transferUsd) * 100,
    kind: "estimate",
    detail:
      `${num(total.cuHours)} horas de cómputo · ${num(total.storageGb)} GB guardados` +
      (total.branchUsd >= 0.005 ? ` · ${USD.format(total.branchUsd)} por ramas de más (1,50 USD al mes cada una)` : ""),
  };
};

const fetchRange = async (
  ctx: AutoContext,
  from: Date,
  to: Date,
  granularity: "monthly" | "daily",
  totals: Map<string, MonthTotal>,
): Promise<string | null> => {
  const project = env(ctx, "NEON_PROJECT_ID");
  let cursor = "";
  // Con un proyecto fijo es una sola página; sin él, hasta 5 páginas de 100.
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      org_id: env(ctx, "NEON_ORG_ID"),
      metrics: METRICS.join(","),
      limit: "100",
      ...(project ? { project_ids: project } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const res = await autoGet(ctx, `${API}?${query}`, {
      Authorization: `Bearer ${env(ctx, "NEON_API_KEY")}`,
      Accept: "application/json",
    });
    if (res.status === 401) return "Neon rechazó la clave: revisa NEON_API_KEY.";
    if (res.status === 403) return "Neon no da el consumo en este plan (hace falta Launch o superior).";
    if (res.status === 404) return "Neon no encontró la organización: revisa NEON_ORG_ID.";
    if (!res.ok) return `Neon respondió ${res.status}.`;
    const data = parseJson<NeonResponse>(res.text);
    if (!data) return "Neon contestó algo que no se pudo leer.";
    sumNeonConsumption(data, totals);
    const next = data.pagination?.cursor ?? "";
    if (project || !next || next === cursor || (data.projects ?? []).length < 100) break;
    cursor = next;
  }
  return null;
};

export const neonCollector: AutoCollector = {
  id: "neon",
  collect: async (months, ctx) => {
    const missing = ["NEON_API_KEY", "NEON_ORG_ID"].filter((name) => !env(ctx, name));
    if (missing.length > 0) return { state: "missing_key", env: missing };

    const currentMonth = monthKeyUtc(ctx.now);
    const currentStart = monthStartUtc(currentMonth);
    const totals = new Map<string, MonthTotal>();

    const first = monthStartUtc(months[0]);
    const end = rangeEndUtc(months, ctx.now);
    const closedEnd = end < currentStart ? end : currentStart;
    if (first < closedEnd) {
      const error = await fetchRange(ctx, first, closedEnd, "monthly", totals);
      if (error) return { state: "error", message: error };
    }
    if (months.includes(currentMonth)) {
      const error = await fetchRange(ctx, currentStart, end, "daily", totals);
      if (error) return { state: "error", message: error };
    }

    const result: Record<string, AutoMonth> = {};
    for (const month of months) {
      const total = totals.get(month);
      if (total) result[month] = neonMonth(total);
    }
    return { state: "ok", months: result };
  },
};
