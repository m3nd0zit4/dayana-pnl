import type { CostServiceId } from "../catalog";

/**
 * Los recolectores automáticos: cada uno le pregunta a un proveedor cuánto se
 * le debe (o cuánto se usó) y devuelve una cifra por mes. Ninguno lanza: lo
 * que salga mal se devuelve como `error`, y la pantalla lo dice.
 */

/** La cifra de un mes para un servicio. */
export type AutoMonth = {
  usdCents: number;
  /** `exact`: lo que el proveedor dice que cobró. `estimate`: uso × tarifa publicada. */
  kind: "exact" | "estimate";
  /** Una línea para quien mira: «23,3 horas de cómputo · 1,2 GB». */
  detail?: string;
};

export type AutoOutcome =
  | { state: "ok"; months: Record<string, AutoMonth>; note?: string }
  /** Falta pegar una clave en el entorno. `env`: cuáles. */
  | { state: "missing_key"; env: string[] }
  | { state: "error"; message: string };

export type AutoFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AutoContext = {
  env: Record<string, string | undefined>;
  fetch: AutoFetch;
  now: Date;
  /** Se corta cuando el recolector agota su tope total (`AUTO_DEADLINE_MS`). */
  signal?: AbortSignal;
};

export type AutoCollector = {
  id: CostServiceId;
  /** `months`: `YYYY-MM`, del más viejo al más nuevo. */
  collect: (months: string[], ctx: AutoContext) => Promise<AutoOutcome>;
};

/** Cuánto se espera a UNA llamada. El tope de todas las de un proveedor está en `index.ts`. */
export const AUTO_TIMEOUT_MS = 8_000;

/** El primer instante (UTC) de un mes `YYYY-MM`. Los proveedores facturan en UTC. */
export const monthStartUtc = (monthKey: string): Date => {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
};

/** `YYYY-MM` (UTC) de un instante. */
export const monthKeyUtc = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/** El inicio del día siguiente a `now`, en UTC: el tope de un rango «hasta hoy». */
export const tomorrowUtc = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

/**
 * Hasta dónde pedir: el final del último mes pedido, o mañana si ese mes aún
 * no termina. Mirar un mes viejo no debe pedir todo lo que va desde entonces.
 */
export const rangeEndUtc = (months: string[], now: Date): Date => {
  const [y, m] = months[months.length - 1].split("-").map(Number);
  const afterLast = new Date(Date.UTC(y, m, 1));
  const tomorrow = tomorrowUtc(now);
  return afterLast < tomorrow ? afterLast : tomorrow;
};

export const env = (ctx: AutoContext, name: string): string => ctx.env[name]?.trim() ?? "";

/** Un GET con tope de tiempo. El cuerpo se lee como texto: quien llama decide el formato. */
export const autoGet = async (
  ctx: AutoContext,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; ok: boolean; text: string }> => {
  const timeout = AbortSignal.timeout(AUTO_TIMEOUT_MS);
  const res = await ctx.fetch(url, { headers, signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout });
  return { status: res.status, ok: res.ok, text: await res.text() };
};

export const parseJson = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const NUMBER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });
export const num = (value: number): string => NUMBER.format(value);
