import {
  autoGet,
  env,
  monthKeyUtc,
  monthStartUtc,
  parseJson,
  rangeEndUtc,
  type AutoCollector,
  type AutoContext,
  type AutoMonth,
} from "./types";

/**
 * Vercel: lo que cobra por el alojamiento y el dominio.
 *
 * Los dos usan la misma clave, `VERCEL_BILLING_TOKEN` (un token de la cuenta
 * con permiso de lectura sobre la facturación del equipo), y
 * `VERCEL_BILLING_TEAM_ID` para decir de qué equipo.
 *
 * - **Alojamiento**: `GET /v1/billing/charges` devuelve los cargos en formato
 *   FOCUS, una línea JSON por cargo y día. Se suma `BilledCost` por mes: es lo
 *   que Vercel factura, no una estimación. En un equipo sin plan de pago
 *   contesta 404 «Plan not found»: se lee como «no cobra nada».
 * - **Dominio**: no hay cargo mensual, se paga por año. Se reparte el precio
 *   de renovación en doce partes desde el mes en que se compró. Solo ve los
 *   dominios comprados en Vercel.
 */

const API = "https://api.vercel.com";

const auth = (ctx: AutoContext) => ({ Authorization: `Bearer ${env(ctx, "VERCEL_BILLING_TOKEN")}` });
const teamQuery = (ctx: AutoContext): string => {
  const team = env(ctx, "VERCEL_BILLING_TEAM_ID");
  return team ? `&teamId=${encodeURIComponent(team)}` : "";
};

type FocusRow = { BilledCost?: string | number; BillingCurrency?: string; ChargePeriodStart?: string };

/** Suma `BilledCost` (dólares) por mes a partir del JSONL de cargos. Puro. */
export const sumVercelCharges = (jsonl: string): Record<string, number> => {
  const usdByMonth: Record<string, number> = {};
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = parseJson<FocusRow>(line);
    const cost = Number(row?.BilledCost);
    const start = row?.ChargePeriodStart ? new Date(row.ChargePeriodStart) : null;
    if (!row || !Number.isFinite(cost) || !start || Number.isNaN(start.getTime())) continue;
    // La cuenta se factura en dólares; un cargo en otra moneda no se puede sumar.
    if (row.BillingCurrency && row.BillingCurrency !== "USD") continue;
    const month = monthKeyUtc(start);
    usdByMonth[month] = (usdByMonth[month] ?? 0) + cost;
  }
  return usdByMonth;
};

export const vercelCollector: AutoCollector = {
  id: "vercel",
  collect: async (months, ctx) => {
    if (!env(ctx, "VERCEL_BILLING_TOKEN")) return { state: "missing_key", env: ["VERCEL_BILLING_TOKEN"] };

    const from = monthStartUtc(months[0]).toISOString();
    const to = rangeEndUtc(months, ctx.now).toISOString();
    const res = await autoGet(
      ctx,
      `${API}/v1/billing/charges?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${teamQuery(ctx)}`,
      auth(ctx),
    );

    const zero = (): Record<string, AutoMonth> =>
      Object.fromEntries(months.map((m) => [m, { usdCents: 0, kind: "exact" as const }]));

    if (res.status === 404 && /plan not found/i.test(res.text)) {
      return { state: "ok", months: zero(), note: "Vercel no reporta cargos: el equipo no tiene un plan de pago." };
    }
    if (res.status === 401 || res.status === 403) {
      return { state: "error", message: "Vercel rechazó la clave: revisa que VERCEL_BILLING_TOKEN pueda ver la facturación del equipo." };
    }
    if (!res.ok) return { state: "error", message: `Vercel respondió ${res.status}.` };

    const usdByMonth = sumVercelCharges(res.text);
    const result = zero();
    for (const month of months) {
      if (usdByMonth[month] != null) result[month] = { usdCents: usdByMonth[month] * 100, kind: "exact" };
    }
    return { state: "ok", months: result };
  },
};

type VercelDomain = { name?: string; boughtAt?: number | null; expiresAt?: number | null; renew?: boolean };
type DomainPrice = { years?: number; renewalPrice?: number | string | null };

const DAY = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Lo que pesa un dominio en cada mes: una doceava parte de su renovación
 * anual, desde el mes en que se compró. Sin renovación automática, deja de
 * contar al vencer. Puro.
 */
export const domainMonths = (
  months: string[],
  domain: { boughtAt: number; expiresAt: number | null; renew: boolean },
  yearlyUsd: number,
): Record<string, number> => {
  const first = monthKeyUtc(new Date(domain.boughtAt));
  const last = !domain.renew && domain.expiresAt ? monthKeyUtc(new Date(domain.expiresAt)) : null;
  const result: Record<string, number> = {};
  for (const month of months) {
    if (month < first || (last && month > last)) continue;
    result[month] = (yearlyUsd / 12) * 100;
  }
  return result;
};

export const domainCollector: AutoCollector = {
  id: "dominio",
  collect: async (months, ctx) => {
    if (!env(ctx, "VERCEL_BILLING_TOKEN")) return { state: "missing_key", env: ["VERCEL_BILLING_TOKEN"] };

    const list = await autoGet(ctx, `${API}/v5/domains?limit=50${teamQuery(ctx)}`, auth(ctx));
    if (list.status === 401 || list.status === 403) {
      return { state: "error", message: "Vercel rechazó la clave al leer los dominios." };
    }
    if (!list.ok) return { state: "error", message: `Vercel respondió ${list.status} al leer los dominios.` };

    const bought = (parseJson<{ domains?: VercelDomain[] }>(list.text)?.domains ?? []).filter(
      (d): d is VercelDomain & { name: string; boughtAt: number } => Boolean(d.name) && typeof d.boughtAt === "number",
    );
    if (bought.length === 0) return { state: "ok", months: {}, note: "Ningún dominio comprado en Vercel." };

    const totals: Record<string, number> = {};
    const details: string[] = [];
    for (const domain of bought) {
      const price = await autoGet(
        ctx,
        `${API}/v1/registrar/domains/${encodeURIComponent(domain.name)}/price?${teamQuery(ctx).slice(1)}`,
        auth(ctx),
      );
      const data = price.ok ? parseJson<DomainPrice>(price.text) : null;
      const renewal = Number(data?.renewalPrice);
      const years = Number(data?.years) || 1;
      if (!Number.isFinite(renewal) || renewal <= 0) {
        return { state: "error", message: `Vercel no dio el precio de renovación de ${domain.name}.` };
      }
      const perMonth = domainMonths(
        months,
        { boughtAt: domain.boughtAt, expiresAt: domain.expiresAt ?? null, renew: domain.renew === true },
        renewal / years,
      );
      for (const [month, cents] of Object.entries(perMonth)) totals[month] = (totals[month] ?? 0) + cents;
      details.push(
        `${domain.name}` +
          (domain.expiresAt ? ` · vence el ${DAY.format(new Date(domain.expiresAt)).replace(/\./g, "")}` : "") +
          (domain.renew === true ? "" : " · renovación automática apagada"),
      );
    }

    const detail = details.join(" · ");
    return {
      state: "ok",
      months: Object.fromEntries(
        Object.entries(totals).map(([month, usdCents]) => [month, { usdCents, kind: "estimate" as const, detail }]),
      ),
    };
  },
};
