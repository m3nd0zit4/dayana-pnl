import { describe, expect, test } from "bun:test";

import { buildCostsMonth, type CostBill, type MonthFacts } from "./build";
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

const build = (bills: CostBill[], factsByMonth: Record<string, MonthFacts> = {}, month = "2026-11") =>
  buildCostsMonth({
    month,
    currentMonth: "2026-11",
    months: monthsEndingAt(month, 6),
    usdToCop: 4000,
    bills,
    factsByMonth,
  });

const row = (data: ReturnType<typeof build>, id: string) => data.services.find((s) => s.id === id);

describe("el mes de costos", () => {
  test("sin nada registrado: todo en cero y todos los servicios a la vista", () => {
    const data = build([]);
    expect(data.totalUsdCents).toBe(0);
    expect(data.hasBills).toBe(false);
    expect(data.bills).toEqual([]);
    expect(data.services.every((s) => s.source === "none")).toBe(true);
    // «Otro» no sale si no tiene nada: no es un servicio.
    expect(row(data, "otro")).toBeUndefined();
    expect(row(data, "vercel")).toBeDefined();
    expect(data.trend).toHaveLength(6);
  });

  test("suma facturas en dólares y en pesos, y reparte la anual", () => {
    const data = build([
      bill({ id: "a", serviceId: "vercel" }),
      bill({ id: "b", serviceId: "resend", currency: "COP", amountMinor: 80_000 }),
      bill({ id: "c", serviceId: "dominio", cadence: "YEARLY", amountMinor: 2400 }),
    ]);
    expect(data.totalUsdCents).toBe(2000 + 2000 + 200);
    expect(data.billsUsdCents).toBe(4200);
    expect(data.measuredUsdCents).toBe(0);
    expect(data.bills.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(row(data, "resend")?.usdCents).toBe(2000);
  });

  test("la factura de la IA manda sobre lo medido; las comisiones se suman", () => {
    const facts: Record<string, MonthFacts> = {
      "2026-11": {
        measured: {
          gemini: { usdCents: 300, kind: "estimate" },
          paypal: { usdCents: 500, kind: "exact" },
        },
        activity: { gemini: "40 respuestas de WhatsApp" },
      },
    };
    const data = build(
      [bill({ id: "g", serviceId: "gemini", amountMinor: 1500 }), bill({ id: "p", serviceId: "paypal", amountMinor: 100 })],
      facts,
    );
    expect(row(data, "gemini")).toMatchObject({ usdCents: 1500, source: "bill", activity: "40 respuestas de WhatsApp" });
    // Lo medido sigue ahí, como referencia.
    expect(row(data, "gemini")?.measured?.usdCents).toBe(300);
    expect(row(data, "paypal")).toMatchObject({ usdCents: 600, source: "both" });
    expect(data.totalUsdCents).toBe(2100);
    expect(data.billsUsdCents).toBe(1600);
    expect(data.measuredUsdCents).toBe(500);
  });

  test("lo que más cuesta va arriba y lo que no tiene cifra, al final", () => {
    const data = build([bill({ id: "n", serviceId: "neon", amountMinor: 9000 }), bill({ id: "v", serviceId: "vercel" })]);
    expect(data.services.slice(0, 2).map((s) => s.id)).toEqual(["neon", "vercel"]);
    expect(data.services.at(-1)?.source).toBe("none");
  });

  test("una factura con un servicio desconocido cae en «Otro»", () => {
    const data = build([bill({ id: "x", serviceId: "algo-raro", amountMinor: 700 })]);
    expect(row(data, "otro")).toMatchObject({ usdCents: 700, source: "bill" });
    expect(data.bills[0].serviceName).toBe("Otro");
  });

  test("la tendencia y el mes anterior usan las mismas cuentas", () => {
    const data = build([
      bill({ id: "old", serviceId: "vercel", startsOn: "2026-08-01", endsOn: "2026-10-31" }),
      bill({ id: "one", serviceId: "otro", cadence: "ONE_TIME", amountMinor: 5000, startsOn: "2026-09-12" }),
    ]);
    expect(data.trend).toEqual([
      { month: "2026-06", usdCents: 0 },
      { month: "2026-07", usdCents: 0 },
      { month: "2026-08", usdCents: 2000 },
      { month: "2026-09", usdCents: 7000 },
      { month: "2026-10", usdCents: 2000 },
      { month: "2026-11", usdCents: 0 },
    ]);
    expect(data.previousUsdCents).toBe(2000);
    // En noviembre ya ninguna cuenta, pero sí hay facturas registradas.
    expect(data.bills).toEqual([]);
    expect(data.hasBills).toBe(true);
  });

  test("una factura que aún no empieza se lista en el mes actual, sin sumar", () => {
    const future = bill({ id: "f", serviceId: "mux", startsOn: "2027-11-09" });
    const now = build([bill({ id: "v", serviceId: "vercel" }), future]);
    expect(now.bills.map((b) => [b.id, b.upcoming])).toEqual([
      ["v", false],
      ["f", true],
    ]);
    expect(now.totalUsdCents).toBe(2000);
    expect(row(now, "mux")?.source).toBe("none");
    // En un mes pasado no aparece: ahí solo va lo que contó.
    expect(build([future], {}, "2026-10").bills).toEqual([]);
  });

  test("la vista previa pasa por las mismas cuentas", () => {
    const data = previewCostsMonth(undefined);
    expect(data.month).toBe("2026-11");
    expect(data.totalUsdCents).toBeGreaterThan(0);
    expect(data.totalUsdCents).toBeCloseTo(data.billsUsdCents + data.measuredUsdCents, 6);
    expect(previewCostsMonth("2026-09").month).toBe("2026-09");
    expect(previewCostsMonth("2027-01").month).toBe("2026-11");
  });
});
