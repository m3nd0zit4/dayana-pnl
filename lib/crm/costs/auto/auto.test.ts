import { describe, expect, test } from "bun:test";

import { aiCostUsd, hasAiPrice } from "../ai-prices";
import { AUTO_FRESH_MS, AUTO_RETRY_MS, autoSettingKey, collectAuto, type AutoStore } from "./index";
import { muxCollector, muxMonth, toMuxAsset } from "./mux";
import { neonCollector, neonCostUsd, neonMonth, sumNeonConsumption } from "./neon";
import type { AutoCollector, AutoContext, AutoFetch } from "./types";
import { domainCollector, domainMonths, sumVercelCharges, vercelCollector } from "./vercel";

/**
 * Sin red: cada proveedor es un `fetch` de mentira que contesta lo que su
 * documentación dice que contesta.
 */

const NOW = new Date("2026-11-20T15:00:00.000Z");
const MONTHS = ["2026-09", "2026-10", "2026-11"];

type Route = (url: URL) => { status?: number; body: unknown } | null;

const fakeFetch = (routes: Route[], calls: string[] = []): AutoFetch => {
  return async (input) => {
    calls.push(input);
    const url = new URL(input);
    for (const route of routes) {
      const hit = route(url);
      if (hit) {
        const body = typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body);
        return new Response(body, { status: hit.status ?? 200 });
      }
    }
    return new Response("not found", { status: 404 });
  };
};

const ctx = (env: Record<string, string>, fetch: AutoFetch): AutoContext => ({ env, fetch, now: NOW });

const memoryStore = (initial: Record<string, string> = {}): AutoStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    get: async (key) => data[key] ?? null,
    set: async (key, value) => {
      data[key] = value;
    },
  };
};

describe("Vercel", () => {
  const jsonl = [
    { BilledCost: "20", BillingCurrency: "USD", ChargePeriodStart: "2026-10-01T00:00:00.000Z", ServiceName: "Pro" },
    { BilledCost: "1.25", BillingCurrency: "USD", ChargePeriodStart: "2026-10-14T00:00:00.000Z" },
    { BilledCost: 0.5, BillingCurrency: "USD", ChargePeriodStart: "2026-11-02T00:00:00.000Z" },
    { BilledCost: "9", BillingCurrency: "EUR", ChargePeriodStart: "2026-11-03T00:00:00.000Z" },
    { BilledCost: "no", ChargePeriodStart: "2026-11-03T00:00:00.000Z" },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");

  test("suma lo facturado por mes y se salta lo que no entiende", () => {
    expect(sumVercelCharges(`${jsonl}\n\nbasura\n`)).toEqual({ "2026-10": 21.25, "2026-11": 0.5 });
  });

  test("sin clave: lo dice y no llama a nadie", async () => {
    const calls: string[] = [];
    const out = await vercelCollector.collect(MONTHS, ctx({}, fakeFetch([], calls)));
    expect(out).toEqual({ state: "missing_key", env: ["VERCEL_BILLING_TOKEN"] });
    expect(calls).toEqual([]);
  });

  test("con clave: cada mes pedido tiene su cifra, cero incluido", async () => {
    const calls: string[] = [];
    const out = await vercelCollector.collect(
      MONTHS,
      ctx(
        { VERCEL_BILLING_TOKEN: "t", VERCEL_BILLING_TEAM_ID: "team_x" },
        fakeFetch([(url) => (url.pathname === "/v1/billing/charges" ? { body: jsonl } : null)], calls),
      ),
    );
    expect(out).toEqual({
      state: "ok",
      months: {
        "2026-09": { usdCents: 0, kind: "exact" },
        "2026-10": { usdCents: 2125, kind: "exact" },
        "2026-11": { usdCents: 50, kind: "exact" },
      },
    });
    const url = new URL(calls[0]);
    expect(url.searchParams.get("teamId")).toBe("team_x");
    expect(url.searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-11-21T00:00:00.000Z");
  });

  test("un mes viejo pide solo hasta el final de ese mes, no hasta hoy", async () => {
    const calls: string[] = [];
    await vercelCollector.collect(
      ["2026-06", "2026-07"],
      ctx({ VERCEL_BILLING_TOKEN: "t" }, fakeFetch([() => ({ body: "" })], calls)),
    );
    expect(new URL(calls[0]).searchParams.get("to")).toBe("2026-08-01T00:00:00.000Z");

    const neonCalls: string[] = [];
    await neonCollector.collect(
      ["2026-06", "2026-07"],
      ctx({ NEON_API_KEY: "k", NEON_ORG_ID: "o" }, fakeFetch([() => ({ body: { projects: [] } })], neonCalls)),
    );
    expect(neonCalls).toHaveLength(1);
    expect(new URL(neonCalls[0]).searchParams.get("granularity")).toBe("monthly");
    expect(new URL(neonCalls[0]).searchParams.get("to")).toBe("2026-08-01T00:00:00.000Z");
  });

  test("un equipo sin plan de pago no cobra nada: cero, con su explicación", async () => {
    const out = await vercelCollector.collect(
      MONTHS,
      ctx({ VERCEL_BILLING_TOKEN: "t" }, fakeFetch([() => ({ status: 404, body: { error: { message: "Plan not found." } } })])),
    );
    expect(out.state).toBe("ok");
    expect(out.state === "ok" && out.months["2026-11"]).toEqual({ usdCents: 0, kind: "exact" });
    expect(out.state === "ok" && out.note).toContain("no tiene un plan de pago");
  });

  test("una clave rechazada es un error, no un cero", async () => {
    const out = await vercelCollector.collect(MONTHS, ctx({ VERCEL_BILLING_TOKEN: "t" }, fakeFetch([() => ({ status: 403, body: {} })])));
    expect(out.state).toBe("error");
  });
});

describe("dominio", () => {
  const bought = Date.UTC(2026, 3, 28);
  const expires = Date.UTC(2027, 3, 28);

  test("una doceava parte al mes desde que se compró; sin renovación, hasta que vence", () => {
    const months = ["2026-03", "2026-04", "2027-04", "2027-05"];
    expect(domainMonths(months, { boughtAt: bought, expiresAt: expires, renew: false }, 18)).toEqual({
      "2026-04": 150,
      "2027-04": 150,
    });
    expect(Object.keys(domainMonths(months, { boughtAt: bought, expiresAt: expires, renew: true }, 18))).toEqual([
      "2026-04",
      "2027-04",
      "2027-05",
    ]);
  });

  test("lee los dominios comprados en Vercel y su precio de renovación", async () => {
    const out = await domainCollector.collect(
      MONTHS,
      ctx(
        { VERCEL_BILLING_TOKEN: "t" },
        fakeFetch([
          (url) =>
            url.pathname === "/v5/domains"
              ? {
                  body: {
                    domains: [
                      { name: "dayanabeltran.com", boughtAt: bought, expiresAt: expires, renew: false },
                      // Traído de otro registrador: Vercel no lo cobra.
                      { name: "otro.com", boughtAt: null },
                    ],
                  },
                }
              : null,
          (url) =>
            url.pathname === "/v1/registrar/domains/dayanabeltran.com/price"
              ? { body: { years: 1, purchasePrice: null, renewalPrice: 18, transferPrice: 18 } }
              : null,
        ]),
      ),
    );
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    expect(out.months["2026-10"]).toMatchObject({ usdCents: 150, kind: "estimate" });
    expect(out.months["2026-10"].detail).toContain("dayanabeltran.com");
    expect(out.months["2026-10"].detail).toContain("renovación automática apagada");
  });
});

describe("Neon", () => {
  test("la fórmula de Neon: cómputo, almacenamiento, historial y ramas de más", () => {
    // Los dos ejemplos de su documentación.
    expect(neonCostUsd({ plan: "scale", hours: 24, compute_unit_seconds: 500_000 })).toBeCloseTo(30.83, 2);
    expect(neonCostUsd({ plan: "launch", hours: 24, root_branch_bytes_month: 3_360_000_000 })).toBeCloseTo(1.176, 3);
    // 12 ramas hijas un día en Launch: 288 − 9 × 24 = 72 horas-rama.
    expect(neonCostUsd({ plan: "launch", hours: 24, extra_branches_month: 288 })).toBeCloseTo((72 / 744) * 1.5, 6);
    // Un plan que no se conoce se cuenta como Launch.
    expect(neonCostUsd({ plan: "raro", hours: 24, compute_unit_seconds: 3600 })).toBeCloseTo(0.106, 6);
  });

  const frame = (start: string, end: string, metrics: Record<string, number>) => ({
    timeframe_start: start,
    timeframe_end: end,
    metrics: Object.entries(metrics).map(([metric_name, value]) => ({ metric_name, value })),
  });

  test("meses cerrados por mes, el mes en curso por día, y se suman", async () => {
    const calls: string[] = [];
    const out = await neonCollector.collect(
      MONTHS,
      ctx(
        { NEON_API_KEY: "k", NEON_ORG_ID: "org-x", NEON_PROJECT_ID: "green-cake" },
        fakeFetch(
          [
            (url) =>
              url.searchParams.get("granularity") === "monthly"
                ? {
                    body: {
                      projects: [
                        {
                          project_id: "green-cake",
                          periods: [
                            {
                              period_plan: "launch",
                              consumption: [
                                frame("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", {
                                  compute_unit_seconds: 360_000,
                                  root_branch_bytes_month: 2_000_000_000,
                                }),
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  }
                : null,
            (url) =>
              url.searchParams.get("granularity") === "daily"
                ? {
                    body: {
                      projects: [
                        {
                          project_id: "green-cake",
                          periods: [
                            {
                              period_plan: "launch",
                              consumption: [
                                frame("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", { compute_unit_seconds: 36_000 }),
                                frame("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", { compute_unit_seconds: 36_000 }),
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  }
                : null,
          ],
          calls,
        ),
      ),
    );
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    // Octubre: 100 h × 0,106 + 2 GB × 0,35 = 11,30.
    expect(out.months["2026-10"].usdCents).toBeCloseTo(1130, 6);
    expect(out.months["2026-10"].kind).toBe("estimate");
    expect(out.months["2026-10"].detail).toBe("100 horas de cómputo · 2 GB guardados");
    // Noviembre: 20 h × 0,106.
    expect(out.months["2026-11"].usdCents).toBeCloseTo(212, 6);
    // Septiembre: Neon no trajo nada. Es «sin dato», no cero.
    expect(out.months["2026-09"]).toBeUndefined();

    const [monthly, daily] = calls.map((c) => new URL(c));
    expect(monthly.searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(monthly.searchParams.get("to")).toBe("2026-11-01T00:00:00.000Z");
    expect(monthly.searchParams.get("project_ids")).toBe("green-cake");
    expect(daily.searchParams.get("from")).toBe("2026-11-01T00:00:00.000Z");
    expect(daily.searchParams.get("to")).toBe("2026-11-21T00:00:00.000Z");
  });

  test("un plan contratado a mitad de mes: las ramas incluidas se cuentan desde ese día", () => {
    // Lo que Neon devolvió de verdad para octubre de 2026 (plan Launch desde el 16).
    const totals = sumNeonConsumption({
      projects: [
        {
          project_id: "green-cake",
          periods: [
            {
              period_plan: "launch",
              period_start: "2026-10-16T23:40:05Z",
              period_end: "2026-11-01T00:00:00Z",
              consumption: [
                frame("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", {
                  compute_unit_seconds: 200_968,
                  root_branch_bytes_month: 101_275_978,
                  instant_restore_bytes_month: 4_011_335,
                  snapshot_storage_bytes_month: 46_470_342,
                  public_network_transfer_bytes: 29_027_447_619,
                  extra_branches_month: 6948,
                }),
              ],
            },
          ],
        },
      ],
    });
    const month = neonMonth(totals.get("2026-10")!);
    // Cómputo 55,82 h × 0,106 = 5,92; ramas (6.948 − 9 × 360,33 h) / 744 × 1,50 = 7,47;
    // almacenamiento, historial y copias: 0,04. El tráfico (29 GB) cabe en lo incluido.
    expect(month.usdCents / 100).toBeCloseTo(13.43, 1);
    expect(month.detail).toBe("55,8 horas de cómputo · 0,1 GB guardados · $7.47 por ramas de más (1,50 USD al mes cada una)");
  });

  test("sin claves, y con una clave mala", async () => {
    expect(await neonCollector.collect(MONTHS, ctx({ NEON_API_KEY: "k" }, fakeFetch([])))).toEqual({
      state: "missing_key",
      env: ["NEON_ORG_ID"],
    });
    const bad = await neonCollector.collect(
      MONTHS,
      ctx({ NEON_API_KEY: "k", NEON_ORG_ID: "o" }, fakeFetch([() => ({ status: 401, body: {} })])),
    );
    expect(bad).toEqual({ state: "error", message: "Neon rechazó la clave: revisa NEON_API_KEY." });
  });
});

describe("Mux", () => {
  const asset = (minutes: number, created: string, over: Record<string, unknown> = {}) => ({
    status: "ready",
    duration: minutes * 60,
    resolution_tier: "1080p",
    video_quality: "basic",
    created_at: String(Date.parse(created) / 1000),
    ...over,
  });

  test("un video que aún se está procesando no cuenta", () => {
    expect(toMuxAsset(asset(10, "2026-10-01T00:00:00Z", { status: "preparing" }))).toBeNull();
    expect(toMuxAsset(asset(10, "2026-10-01T00:00:00Z"))).toMatchObject({ minutes: 10, tier: "1080p", quality: "basic" });
  });

  test("poco uso: cabe en los 20 USD que Mux regala", () => {
    const assets = [toMuxAsset(asset(3000, "2026-08-10T00:00:00Z"))!];
    // 3.000 min × 0,003 = 9 USD de almacenamiento, menos 20 de crédito.
    const month = muxMonth("2026-10", assets, 450);
    expect(month?.usdCents).toBe(0);
    expect(month?.detail).toBe("3.000 min guardados · 450 min vistos · dentro de los 20 USD de uso que Mux regala cada mes");
    // Antes de subirlos no había nada.
    expect(muxMonth("2026-07", assets, null)).toBeNull();
  });

  test("mucho uso: almacenamiento, subida en calidad plus y reproducción sobre lo gratis", () => {
    const assets = [
      toMuxAsset(asset(10_000, "2026-08-10T00:00:00Z"))!,
      toMuxAsset(asset(1000, "2026-10-05T00:00:00Z", { video_quality: "plus" }))!,
    ];
    // Guardar 11.000 × 0,003 = 33; subir 1.000 × 0,03125 = 31,25;
    // ver (150.000 − 100.000) × 0,001 = 50; menos 20 de crédito.
    expect(muxMonth("2026-10", assets, 150_000)?.usdCents).toBeCloseTo((33 + 31.25 + 50 - 20) * 100, 6);
    // Al mes siguiente ya no se paga la subida.
    expect(muxMonth("2026-11", assets, 0)?.usdCents).toBeCloseTo((33 - 20) * 100, 6);
  });

  test("pregunta por los videos y por lo visto solo dentro de los últimos 90 días", async () => {
    const calls: string[] = [];
    const out = await muxCollector.collect(
      ["2026-06", "2026-10", "2026-11"],
      ctx(
        { MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "secret" },
        fakeFetch(
          [
            (url) => (url.pathname === "/video/v1/assets" ? { body: { data: [asset(10_000, "2026-05-10T00:00:00Z")] } } : null),
            (url) => (url.pathname === "/video/v1/delivery-usage" ? { body: { data: [{ delivered_seconds: 6000 }] } } : null),
          ],
          calls,
        ),
      ),
    );
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    expect(out.months["2026-06"].detail).toBe("10.000 min guardados");
    expect(out.months["2026-10"].detail).toBe("10.000 min guardados · 100 min vistos");
    expect(out.months["2026-10"].usdCents).toBeCloseTo(1000, 6);
    expect(calls.filter((c) => c.includes("delivery-usage"))).toHaveLength(2);
    expect(await muxCollector.collect(MONTHS, ctx({}, fakeFetch([])))).toEqual({
      state: "missing_key",
      env: ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"],
    });
  });
});

describe("lo guardado de los proveedores", () => {
  const counting = (outcomes: Awaited<ReturnType<AutoCollector["collect"]>>[]): AutoCollector & { calls: number } => {
    const collector = {
      id: "neon" as const,
      calls: 0,
      collect: async () => outcomes[Math.min(collector.calls++, outcomes.length - 1)],
    };
    return collector;
  };
  const ok = (cents: number) => ({ state: "ok" as const, months: { "2026-11": { usdCents: cents, kind: "estimate" as const } } });
  const run = (collector: AutoCollector, store: AutoStore, now: Date, months = MONTHS) =>
    collectAuto(months, { store, now, env: {}, fetch: fakeFetch([]), collectors: [collector] });

  test("pregunta una vez y luego usa lo guardado durante seis horas", async () => {
    const store = memoryStore();
    const collector = counting([ok(100), ok(250)]);

    const first = await run(collector, store, NOW);
    expect(first.months["2026-11"].neon?.usdCents).toBe(100);
    expect(first.status.neon?.state).toBe("ok");
    expect(Object.keys(JSON.parse(store.data[autoSettingKey("neon")]).askedAt)).toEqual(MONTHS);

    // Septiembre y octubre no trajeron cifra, pero ya se preguntó: no se repite.
    const again = await run(collector, store, new Date(NOW.getTime() + AUTO_FRESH_MS - 1000));
    expect(collector.calls).toBe(1);
    expect(again.months["2026-11"].neon?.usdCents).toBe(100);

    const later = await run(collector, store, new Date(NOW.getTime() + AUTO_FRESH_MS + 1000));
    expect(collector.calls).toBe(2);
    expect(later.months["2026-11"].neon?.usdCents).toBe(250);
  });

  test("un mes que no se había preguntado obliga a preguntar", async () => {
    const store = memoryStore();
    const collector = counting([ok(100)]);
    await run(collector, store, NOW);
    await run(collector, store, NOW, ["2026-05", "2026-06"]);
    expect(collector.calls).toBe(2);
    // Y lo de antes sigue valiendo.
    await run(collector, store, NOW);
    expect(collector.calls).toBe(2);
  });

  test("mirar otro mes no rejuvenece lo que no se volvió a pedir", async () => {
    const store = memoryStore();
    const collector = counting([ok(100), ok(100), ok(300)]);
    const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

    await run(collector, store, NOW);
    // Cinco horas después se mira una ventana vieja: se pregunta solo por ella.
    await run(collector, store, hours(5), ["2026-05", "2026-06"]);
    expect(collector.calls).toBe(2);
    // A las siete horas noviembre ya está viejo, aunque se haya preguntado otra cosa hace dos.
    const later = await run(collector, store, hours(7));
    expect(collector.calls).toBe(3);
    expect(later.months["2026-11"].neon?.usdCents).toBe(300);
  });

  test("un proveedor que falló no se vuelve a llamar en cada visita", async () => {
    const store = memoryStore();
    const collector = counting([{ state: "error", message: "Neon respondió 500." }, ok(100)]);
    expect((await run(collector, store, NOW)).status.neon).toEqual({ state: "error", message: "Neon respondió 500." });
    const soon = await run(collector, store, new Date(NOW.getTime() + AUTO_RETRY_MS - 1000));
    expect(collector.calls).toBe(1);
    expect(soon.status.neon).toEqual({ state: "error", message: "Neon respondió 500." });
    const later = await run(collector, store, new Date(NOW.getTime() + AUTO_RETRY_MS + 1000));
    expect(collector.calls).toBe(2);
    expect(later.status.neon?.state).toBe("ok");
    expect(JSON.parse(store.data[autoSettingKey("neon")]).failedAt).toBeUndefined();
  });

  test("un proveedor que no contesta no cuelga la pantalla: se corta y se dice", async () => {
    let aborted = false;
    const hanging: AutoCollector = {
      id: "neon",
      collect: (_months, ctx) =>
        new Promise(() => {
          ctx.signal?.addEventListener("abort", () => (aborted = true));
        }),
    };
    const started = Date.now();
    const out = await collectAuto(MONTHS, { store: memoryStore(), now: NOW, env: {}, fetch: fakeFetch([]), collectors: [hanging], deadlineMs: 30 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.status.neon).toEqual({ state: "error", message: "El proveedor tardó demasiado en contestar." });
    expect(aborted).toBe(true);
  });

  test("si el proveedor falla se enseña lo último guardado, y se dice", async () => {
    const store = memoryStore();
    const collector = counting([ok(100), { state: "error", message: "Neon respondió 500." }]);
    await run(collector, store, NOW);
    const later = await run(collector, store, new Date(NOW.getTime() + AUTO_FRESH_MS + 1000));
    expect(later.months["2026-11"].neon?.usdCents).toBe(100);
    expect(later.status.neon).toMatchObject({ state: "stale", message: "Neon respondió 500." });
  });

  test("sin nada guardado, un fallo es un fallo: ninguna cifra inventada", async () => {
    const failing = await run(counting([{ state: "error", message: "Neon respondió 500." }]), memoryStore(), NOW);
    expect(failing.months).toEqual({});
    expect(failing.status.neon?.state).toBe("error");

    const throwing: AutoCollector = {
      id: "neon",
      collect: async () => {
        throw new Error("boom");
      },
    };
    expect((await run(throwing, memoryStore(), NOW)).status.neon?.state).toBe("error");
  });

  test("sin clave no se enseña nada viejo", async () => {
    const store = memoryStore();
    await run(counting([ok(100)]), store, NOW);
    const out = await run(counting([{ state: "missing_key", env: ["NEON_API_KEY", "NEON_ORG_ID"] }]), store, new Date(NOW.getTime() + AUTO_FRESH_MS + 1000));
    expect(out.months).toEqual({});
    expect(out.status.neon).toEqual({
      state: "missing_key",
      message: "Falta pegar NEON_API_KEY y NEON_ORG_ID en las variables de entorno de Vercel.",
    });
  });

  test("lo guardado ilegible se ignora", async () => {
    const store = memoryStore({ [autoSettingKey("neon")]: "{no es json" });
    const out = await run(counting([ok(100)]), store, NOW);
    expect(out.months["2026-11"].neon?.usdCents).toBe(100);
  });
});

describe("precio de la IA", () => {
  test("texto, caché, audio y salida, cada uno a su precio", () => {
    const tokens = { inputTokens: 1_000_000, cachedTokens: 400_000, audioTokens: 100_000, outputTokens: 100_000 };
    // flash-lite: 500k × 0,30 + 400k × 0,03 + 100k × 0,30 + 100k × 2,50.
    expect(aiCostUsd(tokens, "gemini-3.5-flash-lite")).toBeCloseTo(0.15 + 0.012 + 0.03 + 0.25, 9);
    // 2.5-flash cobra el audio a 1,00.
    expect(aiCostUsd(tokens, "gemini-2.5-flash")).toBeCloseTo(0.15 + 0.012 + 0.1 + 0.25, 9);
  });

  test("un modelo sin tarifa publicada se cuenta como flash-lite, y se sabe", () => {
    const tokens = { inputTokens: 1000, cachedTokens: 0, audioTokens: 0, outputTokens: 1000 };
    expect(hasAiPrice("gemini-3.5-flash")).toBe(false);
    expect(aiCostUsd(tokens, "gemini-3.5-flash")).toBe(aiCostUsd(tokens, "gemini-3.5-flash-lite"));
  });

  test("más caché que entrada no da negativo", () => {
    expect(aiCostUsd({ inputTokens: 100, cachedTokens: 500, audioTokens: 500, outputTokens: 0 }, "gemini-3.5-flash-lite")).toBeCloseTo(
      (100 * 0.03) / 1_000_000,
      12,
    );
  });
});
