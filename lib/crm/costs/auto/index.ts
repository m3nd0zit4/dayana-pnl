import type { CostServiceId } from "../catalog";
import { muxCollector } from "./mux";
import { neonCollector } from "./neon";
import type { AutoCollector, AutoContext, AutoFetch, AutoMonth, AutoOutcome } from "./types";
import { domainCollector, vercelCollector } from "./vercel";

/**
 * Junta lo que dicen los proveedores y lo guarda para no preguntarles en cada
 * visita.
 *
 * Lo guardado vive en `site_settings` (`costs.auto.<servicio>`), no en memoria:
 * en Vercel cada visita puede caer en otra instancia. Cada mes lleva la hora
 * en que se preguntó por él; se vuelve a preguntar cuando alguno de los meses
 * pedidos tiene más de seis horas o nunca se pidió.
 *
 * La pantalla espera a esto para pintarse, así que nada aquí puede tardar sin
 * límite: cada proveedor tiene un tope total (`AUTO_DEADLINE_MS`) y, si falla,
 * no se le vuelve a preguntar hasta pasados diez minutos. Si falla y hay algo
 * guardado se enseña lo guardado y se dice; nunca se pinta un cero inventado.
 */

export const AUTO_COLLECTORS: AutoCollector[] = [vercelCollector, domainCollector, neonCollector, muxCollector];

/** Cada cuánto se vuelve a preguntar al proveedor por un mes. */
export const AUTO_FRESH_MS = 6 * 60 * 60 * 1000;
/** Lo máximo que se espera a un proveedor, sumando todas sus llamadas. */
export const AUTO_DEADLINE_MS = 15_000;
/** Tras un fallo, cuánto se deja en paz al proveedor. */
export const AUTO_RETRY_MS = 10 * 60 * 1000;

export const autoSettingKey = (id: CostServiceId): string => `costs.auto.${id}`;

export type AutoStatus = {
  /**
   * `ok`: al día. `stale`: no se pudo actualizar, se enseña lo último guardado.
   * `missing_key`: falta pegar una clave. `error`: falló y no hay nada guardado.
   */
  state: "ok" | "stale" | "missing_key" | "error";
  message?: string;
};

type Cached = {
  months: Record<string, AutoMonth>;
  /**
   * Cuándo se preguntó por cada mes (ISO). No es lo mismo que tener cifra: un
   * proveedor puede no tener nada de un mes (antes de contratarlo), y sin esto
   * se le volvería a preguntar en cada visita.
   */
  askedAt: Record<string, string>;
  note?: string;
  /** El último fallo: cuándo y qué dijo. Se borra cuando vuelve a contestar. */
  failedAt?: string;
  failMessage?: string;
};

export type AutoStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
};

const record = <T>(value: unknown): Record<string, T> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, T>) : {};

const readCache = (raw: string | null): Cached => {
  const empty: Cached = { months: {}, askedAt: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      months: record<AutoMonth>(parsed.months),
      askedAt: record<string>(parsed.askedAt),
      note: typeof parsed.note === "string" ? parsed.note : undefined,
      failedAt: typeof parsed.failedAt === "string" ? parsed.failedAt : undefined,
      failMessage: typeof parsed.failMessage === "string" ? parsed.failMessage : undefined,
    };
  } catch {
    return empty;
  }
};

export type AutoCollection = {
  /** Mes → servicio → cifra. */
  months: Record<string, Partial<Record<CostServiceId, AutoMonth>>>;
  status: Partial<Record<CostServiceId, AutoStatus>>;
};

const missingKeyMessage = (names: string[]): string =>
  names.length === 1
    ? `Falta pegar ${names[0]} en las variables de entorno de Vercel.`
    : `Falta pegar ${names.join(" y ")} en las variables de entorno de Vercel.`;

const age = (now: Date, iso: string | undefined): number => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? Infinity : now.getTime() - at;
};

const SLOW = "El proveedor tardó demasiado en contestar.";

/** El recolector con un tope total: pase lo que pase, contesta antes de `AUTO_DEADLINE_MS`. */
const collectWithDeadline = async (
  collector: AutoCollector,
  months: string[],
  ctx: Omit<AutoContext, "signal">,
  deadlineMs: number,
): Promise<AutoOutcome> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<AutoOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ state: "error", message: SLOW });
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      collector.collect(months, { ...ctx, signal: controller.signal }).catch(
        (e): AutoOutcome => ({
          state: "error",
          message: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? SLOW : "No se pudo consultar al proveedor.",
        }),
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const collectAuto = async (
  months: string[],
  opts: {
    store: AutoStore;
    now?: Date;
    env?: Record<string, string | undefined>;
    fetch?: AutoFetch;
    collectors?: AutoCollector[];
    deadlineMs?: number;
  },
): Promise<AutoCollection> => {
  const now = opts.now ?? new Date();
  const ctx = {
    env: opts.env ?? process.env,
    fetch: opts.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init)),
    now,
  };

  const results = await Promise.all(
    (opts.collectors ?? AUTO_COLLECTORS).map(async (collector) => {
      const key = autoSettingKey(collector.id);
      const cached = readCache(await opts.store.get(key).catch(() => null));
      const hasStored = Object.keys(cached.askedAt).length > 0;
      const failed = (message: string): AutoStatus =>
        hasStored ? { state: "stale", message } : { state: "error", message };

      if (months.every((month) => age(now, cached.askedAt[month]) < AUTO_FRESH_MS)) {
        return { id: collector.id, months: cached.months, status: { state: "ok", message: cached.note } as AutoStatus };
      }
      // Falló hace poco: no se insiste en cada visita.
      if (age(now, cached.failedAt) < AUTO_RETRY_MS) {
        return { id: collector.id, months: cached.months, status: failed(cached.failMessage ?? "No se pudo consultar al proveedor.") };
      }

      const outcome = await collectWithDeadline(collector, months, ctx, opts.deadlineMs ?? AUTO_DEADLINE_MS);

      if (outcome.state === "ok") {
        const merged: Cached = { months: { ...cached.months }, askedAt: { ...cached.askedAt }, note: outcome.note };
        for (const month of months) {
          merged.askedAt[month] = now.toISOString();
          // Un mes pedido que ya no viene deja de valer (p. ej. un video borrado).
          if (month in outcome.months) merged.months[month] = outcome.months[month];
          else delete merged.months[month];
        }
        await opts.store.set(key, JSON.stringify(merged)).catch(() => undefined);
        return { id: collector.id, months: merged.months, status: { state: "ok", message: outcome.note } as AutoStatus };
      }

      if (outcome.state === "missing_key") {
        // Sin clave no se enseña nada viejo: la cifra dejaría de moverse sin que nadie lo note.
        return { id: collector.id, months: {}, status: { state: "missing_key", message: missingKeyMessage(outcome.env) } as AutoStatus };
      }

      await opts.store
        .set(key, JSON.stringify({ ...cached, failedAt: now.toISOString(), failMessage: outcome.message } satisfies Cached))
        .catch(() => undefined);
      return { id: collector.id, months: cached.months, status: failed(outcome.message) };
    }),
  );

  const collection: AutoCollection = { months: {}, status: {} };
  for (const result of results) {
    collection.status[result.id] = result.status;
    for (const month of months) {
      const value = result.months[month];
      if (value) (collection.months[month] ??= {})[result.id] = value;
    }
  }
  return collection;
};
