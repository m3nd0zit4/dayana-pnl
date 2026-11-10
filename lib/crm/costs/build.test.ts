import { describe, expect, test } from "bun:test";

import { buildCostsMonth, type CostBill, type MonthFacts, type ServiceStatus } from "./build";
import type { CostServiceId } from "./catalog";
import { fixedPlanBills, pendingFixedPlans, type FixedPlan } from "./fixed-plans";
import { previewCostsMonth } from "./preview";
import { monthsEndingAt } from "./rules";

const bill = (over: Partial<CostBill> & Pick<CostBill, "id" | "serviceId">): CostBill => ({
  label: "Plan",
  cadence: "MONTHLY",
  currency: "USD",
  amountMinor: 2000,
  startsOn: "2026-06-01",
  endsOn: null,
  note: null,
  ...over,
});

const build = (
  bills: CostBill[],
  factsByMonth: Record<string, MonthFacts> = {},
  month = "2026-11",
  status: Partial<Record<CostServiceId, ServiceStatus>> = {},
) =>
  buildCostsMonth({
    month,
    currentMonth: "2026-11",
    months: monthsEndingAt(month, 6),
    usdToCop: 4000,
    bills,
    factsByMonth,
    status,
  });

const row = (data: ReturnType<typeof build>, id: string) => data.services.find((s) => s.id === id);

describe("el mes de costos", () => {
  test("sin nada: total en cero y ninguna fila vacía que no diga nada", () => {
    const data = build([]);
    expect(data.totalUsdCents).toBe(0);
    expect(data.services).toEqual([]);
    expect(data.bills).toEqual([]);
    expect(data.pending).toBe(0);
    expect(data.trend).toHaveLength(6);
  });

  test("lo automático suma solo: lo facturado y lo calculado", () => {
    const data = build([], {
      "2026-11": {
        measured: {
          vercel: { usdCents: 2000, kind: "exact" },
          neon: { usdCents: 1234.5, kind: "estimate" },
        },
        activity: { neon: "98,4 horas de cómputo · 1,3 GB guardados", resend: "12 correos enviados" },
      },
    });
    expect(data.totalUsdCents).toBe(3234.5);
    expect(data.autoUsdCents).toBe(3234.5);
    expect(data.manualUsdCents).toBe(0);
    expect(row(data, "vercel")).toMatchObject({ source: "measured", measured: { kind: "exact" } });
    expect(row(data, "neon")?.activity).toBe("98,4 horas de cómputo · 1,3 GB guardados");
    // Un servicio sin cifra pero con uso sí sale: dice cuántos correos fueron.
    expect(row(data, "resend")).toMatchObject({ source: "none", activity: "12 correos enviados" });
    // Uno sin nada, no.
    expect(row(data, "twilio")).toBeUndefined();
    expect(row(data, "otro")).toBeUndefined();
  });

  test("un plan fijo cuenta como automático; lo apuntado a mano, aparte", () => {
    const data = build([
      bill({ id: "fixed:whatsapp:0", serviceId: "whatsapp", amountMinor: 5300, fixed: true }),
      bill({ id: "m", serviceId: "otro", cadence: "ONE_TIME", currency: "COP", amountMinor: 80_000, startsOn: "2026-11-04" }),
    ]);
    expect(data.totalUsdCents).toBe(5300 + 2000);
    expect(data.autoUsdCents).toBe(5300);
    expect(data.manualUsdCents).toBe(2000);
    expect(row(data, "whatsapp")).toMatchObject({ source: "bill", fixedOnly: true });
    expect(row(data, "otro")).toMatchObject({ source: "bill", fixedOnly: false });
    expect(data.bills.map((b) => [b.id, b.fixed])).toEqual([
      ["fixed:whatsapp:0", true],
      ["m", false],
    ]);
  });

  test("un plan gratuito confirmado es un dato: 0, no «falta»", () => {
    const data = build([bill({ id: "fixed:upstash:0", serviceId: "upstash", amountMinor: 0, fixed: true })]);
    expect(row(data, "upstash")).toMatchObject({ usdCents: 0, source: "bill", fixedOnly: true });
    expect(data.pending).toBe(0);
  });

  test("lo apuntado manda sobre lo calculado; en «Otro» se suma", () => {
    const facts: Record<string, MonthFacts> = {
      "2026-11": { measured: { gemini: { usdCents: 300, kind: "estimate" } }, activity: {} },
    };
    const data = build(
      [
        bill({ id: "g", serviceId: "gemini", amountMinor: 1500 }),
        bill({ id: "o1", serviceId: "otro", amountMinor: 100 }),
        bill({ id: "o2", serviceId: "otro", amountMinor: 250 }),
      ],
      facts,
    );
    expect(row(data, "gemini")).toMatchObject({ usdCents: 1500, source: "bill" });
    // Lo calculado sigue ahí, como referencia, pero no suma.
    expect(row(data, "gemini")?.measured?.usdCents).toBe(300);
    expect(row(data, "otro")?.usdCents).toBe(350);
    expect(data.totalUsdCents).toBe(1850);
    expect(data.autoUsdCents).toBe(0);
    expect(data.manualUsdCents).toBe(1850);
  });

  test("lo que falta se dice y se cuenta: el total está incompleto", () => {
    const data = build(
      [],
      { "2026-11": { measured: { vercel: { usdCents: 0, kind: "exact" } }, activity: {} } },
      "2026-11",
      {
        neon: { state: "missing_key", message: "Falta pegar NEON_API_KEY en las variables de entorno de Vercel." },
        resend: { state: "missing_price", message: "Falta el precio del plan." },
        mux: { state: "stale", message: "Mux respondió 500. Se muestra lo último que dijo Mux." },
      },
    );
    expect(row(data, "neon")).toMatchObject({ source: "none", status: { state: "missing_key" } });
    expect(row(data, "resend")?.status?.state).toBe("missing_price");
    // «No se pudo actualizar» no deja el total incompleto: hay una cifra guardada.
    expect(data.pending).toBe(2);
    // Lo que tiene cifra va primero, aunque sea cero.
    expect(data.services[0].id).toBe("vercel");
  });

  test("lo que más cuesta va arriba", () => {
    const data = build([], {
      "2026-11": {
        measured: { vercel: { usdCents: 2000, kind: "exact" }, neon: { usdCents: 9000, kind: "estimate" } },
        activity: {},
      },
    });
    expect(data.services.map((s) => s.id)).toEqual(["neon", "vercel"]);
  });

  test("algo apuntado con un servicio desconocido cae en «Otro»", () => {
    const data = build([bill({ id: "x", serviceId: "paypal", amountMinor: 700 })]);
    expect(row(data, "otro")).toMatchObject({ usdCents: 700, source: "bill" });
    expect(data.bills[0].serviceName).toBe("Otro");
  });

  test("la tendencia y el mes anterior usan las mismas cuentas", () => {
    const data = build(
      [
        bill({ id: "old", serviceId: "vercel", startsOn: "2026-08-01", endsOn: "2026-10-31" }),
        bill({ id: "one", serviceId: "otro", cadence: "ONE_TIME", amountMinor: 5000, startsOn: "2026-09-12" }),
      ],
      { "2026-10": { measured: { neon: { usdCents: 1000, kind: "estimate" } }, activity: {} } },
    );
    expect(data.trend).toEqual([
      { month: "2026-06", usdCents: 0 },
      { month: "2026-07", usdCents: 0 },
      { month: "2026-08", usdCents: 2000 },
      { month: "2026-09", usdCents: 7000 },
      { month: "2026-10", usdCents: 3000 },
      { month: "2026-11", usdCents: 0 },
    ]);
    expect(data.previousUsdCents).toBe(3000);
    expect(data.bills).toEqual([]);
  });

  test("algo apuntado que aún no empieza se lista en el mes actual, sin sumar", () => {
    const future = bill({ id: "f", serviceId: "otro", startsOn: "2027-11-09" });
    const now = build([bill({ id: "v", serviceId: "otro", label: "Otra cosa" }), future]);
    expect(now.bills.map((b) => [b.id, b.upcoming])).toEqual([
      ["v", false],
      ["f", true],
    ]);
    expect(now.totalUsdCents).toBe(2000);
    // En un mes pasado no aparece: ahí solo va lo que contó.
    expect(build([future], {}, "2026-10").bills).toEqual([]);
    // Un plan fijo que empieza más adelante no se anuncia: se verá cuando cuente.
    expect(build([{ ...future, fixed: true }]).bills).toEqual([]);
  });

  test("la vista previa pasa por las mismas cuentas", () => {
    const data = previewCostsMonth(undefined);
    expect(data.month).toBe("2026-11");
    expect(data.totalUsdCents).toBeGreaterThan(0);
    expect(data.totalUsdCents).toBeCloseTo(data.autoUsdCents + data.manualUsdCents, 6);
    expect(data.pending).toBe(2);
    expect(previewCostsMonth("2026-09").month).toBe("2026-09");
    expect(previewCostsMonth("2027-01").month).toBe("2026-11");
  });
});

describe("planes fijos", () => {
  const plans: FixedPlan[] = [
    { serviceId: "whatsapp", label: "Licencia de 360dialog", usdCents: 5300, since: "2026-09-01" },
    { serviceId: "resend", label: "Plan de Resend", usdCents: null, since: null },
    { serviceId: "upstash", label: "Plan de Upstash", usdCents: 0, since: "2026-06-01" },
    // Con precio pero sin fecha: no se puede contar.
    { serviceId: "google", label: "Google Workspace", usdCents: 600, since: null },
    // Cambio de plan: la línea vieja se cerró y hay una nueva.
    { serviceId: "inngest", label: "Inngest (plan anterior)", usdCents: 2000, since: "2026-06-01", until: "2026-08-31" },
    { serviceId: "inngest", label: "Plan de Inngest", usdCents: null, since: null },
  ];

  test("solo los que tienen precio y fecha se vuelven facturas mensuales", () => {
    const bills = fixedPlanBills(plans);
    expect(bills.map((b) => [b.serviceId, b.amountMinor, b.startsOn, b.endsOn])).toEqual([
      ["whatsapp", 5300, "2026-09-01", null],
      ["upstash", 0, "2026-06-01", null],
      ["inngest", 2000, "2026-06-01", "2026-08-31"],
    ]);
    expect(bills.every((b) => b.fixed && b.cadence === "MONTHLY" && b.currency === "USD")).toBe(true);
    expect(new Set(bills.map((b) => b.id)).size).toBe(bills.length);
  });

  test("lo pendiente: servicios con alguna línea sin precio o sin fecha", () => {
    // Inngest tiene su plan viejo con precio, pero el vigente aún no se sabe.
    expect(pendingFixedPlans(plans).sort()).toEqual(["google", "inngest", "resend"]);
  });

  test("un plan fijo cuenta desde su mes y no antes", () => {
    const data = build(fixedPlanBills(plans), {}, "2026-08");
    expect(row(data, "whatsapp")).toBeUndefined();
    expect(row(data, "inngest")?.usdCents).toBe(2000);
    expect(build(fixedPlanBills(plans), {}, "2026-09").totalUsdCents).toBe(5300);
  });
});
