import type { Plan } from "../plans";

/** Clave en `site_settings` (CRM). */
export const USD_TO_COP_SETTING_KEY = "usd_to_cop_rate";

/** Tasa por defecto cuando no hay valor en CRM ni en env. */
export const DEFAULT_USD_TO_COP_RATE = 3500;

export const parseUsdToCopRate = (value: unknown): number | null => {
  const n =
    typeof value === "string"
      ? Number(value.trim())
      : typeof value === "number"
        ? value
        : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n);
};

export const getUsdToCopRateFromEnv = (): number =>
  parseUsdToCopRate(process.env.MERCADOPAGO_USD_TO_COP) ??
  DEFAULT_USD_TO_COP_RATE;

/** Referencia COP en cartas de precio (redondeo entero). */
export const usdToCopApprox = (usd: number, rate: number): number =>
  Math.round(usd * rate);

export const applyCopToPlan = (plan: Plan, rate: number): Plan => ({
  ...plan,
  amountCop: usdToCopApprox(plan.amountUsd, rate),
});

export const applyCopToPlans = (plans: Plan[], rate: number): Plan[] =>
  plans.map((plan) => applyCopToPlan(plan, rate));
