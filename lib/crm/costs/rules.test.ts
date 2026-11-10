import { describe, expect, test } from "bun:test";

import { COST_SERVICE_IDS, COST_SERVICES } from "./catalog";
import {
  addMonths,
  amountInputValue,
  billAmountForMonth,
  billAppliesTo,
  combineCost,
  estimateFeeMinor,
  formatBillAmount,
  formatUsdCents,
  isDateKey,
  monthLabel,
  monthsEndingAt,
  parseAmountInput,
  parseBillInput,
  resolveMonth,
  toUsdCents,
  type BillLike,
} from "./rules";

const bill = (over: Partial<BillLike> = {}): BillLike => ({
  serviceId: "vercel",
  cadence: "MONTHLY",
  currency: "USD",
  amountMinor: 2000,
  startsOn: "2026-06-15",
  endsOn: null,
  ...over,
});

describe("catálogo de servicios", () => {
  test("cada id tiene su entrada, con nombre y para qué sirve", () => {
    for (const id of COST_SERVICE_IDS) {
      expect(COST_SERVICES[id].name.length).toBeGreaterThan(0);
      expect(COST_SERVICES[id].what.length).toBeGreaterThan(0);
    }
  });

  test("las comisiones de pago se suman a una factura; la IA no", () => {
    expect(COST_SERVICES.paypal.combine).toBe("sum");
    expect(COST_SERVICES.mercadopago.combine).toBe("sum");
    expect(COST_SERVICES.gemini.combine).toBe("bill-wins");
  });
});

describe("meses", () => {
  test("sumar y restar meses cruza el año", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", -14)).toBe("2025-01");
  });

  test("los seis meses que terminan en uno, del más viejo al más nuevo", () => {
    expect(monthsEndingAt("2026-02", 6)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  test("un mes futuro o mal escrito cae en el mes actual", () => {
    expect(resolveMonth("2026-09", "2026-11")).toBe("2026-09");
    expect(resolveMonth("2026-11", "2026-11")).toBe("2026-11");
    expect(resolveMonth("2026-12", "2026-11")).toBe("2026-11");
    expect(resolveMonth("2026-13", "2026-11")).toBe("2026-11");
    expect(resolveMonth(undefined, "2026-11")).toBe("2026-11");
    expect(resolveMonth(["2026-09"], "2026-11")).toBe("2026-11");
  });

  test("el nombre del mes en español", () => {
    expect(monthLabel("2026-11")).toBe("noviembre de 2026");
  });

  test("una fecha tiene que existir", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-31")).toBe(false);
    expect(isDateKey("2026-2-1")).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
});

describe("cuándo cuenta una factura", () => {
  test("mensual: desde su mes de inicio, sin fin", () => {
    const b = bill();
    expect(billAppliesTo(b, "2026-05")).toBe(false);
    expect(billAppliesTo(b, "2026-06")).toBe(true);
    expect(billAppliesTo(b, "2027-03")).toBe(true);
    expect(billAmountForMonth(b, "2026-11")).toBe(2000);
  });

  test("mensual cancelada: el último mes cuenta solo si llegó a cobrarse", () => {
    // Se cobra los días 15.
    const paid = bill({ endsOn: "2026-09-15" });
    expect(billAppliesTo(paid, "2026-09")).toBe(true);
    expect(billAppliesTo(paid, "2026-10")).toBe(false);
    expect(billAmountForMonth(paid, "2026-10")).toBe(0);

    const unpaid = bill({ endsOn: "2026-09-14" });
    expect(billAppliesTo(unpaid, "2026-08")).toBe(true);
    expect(billAppliesTo(unpaid, "2026-09")).toBe(false);
  });

  test("cancelada el mismo mes en que empezó: ese mes se pagó", () => {
    expect(billAppliesTo(bill({ endsOn: "2026-06-20" }), "2026-06")).toBe(true);
    expect(billAppliesTo(bill({ endsOn: "2026-06-20" }), "2026-07")).toBe(false);
  });

  test("un cobro del día 31 cae el último día en un mes corto", () => {
    const b = bill({ startsOn: "2026-01-31", endsOn: "2026-04-30" });
    expect(billAppliesTo(b, "2026-04")).toBe(true);
    expect(billAppliesTo(bill({ startsOn: "2026-01-31", endsOn: "2026-04-29" }), "2026-04")).toBe(false);
  });

  test("anual de aniversario a aniversario: doce meses, no trece", () => {
    const b = bill({ cadence: "YEARLY", amountMinor: 2400, startsOn: "2026-03-10", endsOn: "2027-03-10" });
    const months = Array.from({ length: 14 }, (_, i) => addMonths("2026-03", i));
    expect(months.filter((m) => billAppliesTo(b, m))).toHaveLength(12);
    expect(billAppliesTo(b, "2027-02")).toBe(true);
    expect(billAppliesTo(b, "2027-03")).toBe(false);
    expect(months.reduce((sum, m) => sum + billAmountForMonth(b, m), 0)).toBe(2400);
  });

  test("anual: se reparte en doce partes", () => {
    const b = bill({ serviceId: "dominio", cadence: "YEARLY", amountMinor: 2400, startsOn: "2026-03-01" });
    expect(billAmountForMonth(b, "2026-02")).toBe(0);
    expect(billAmountForMonth(b, "2026-03")).toBe(200);
    expect(billAmountForMonth(b, "2027-08")).toBe(200);
  });

  test("cobro suelto: solo en su mes", () => {
    const b = bill({ cadence: "ONE_TIME", startsOn: "2026-10-31" });
    expect(billAmountForMonth(b, "2026-10")).toBe(2000);
    expect(billAmountForMonth(b, "2026-11")).toBe(0);
    expect(billAmountForMonth(b, "2026-09")).toBe(0);
  });
});

describe("dinero", () => {
  test("pesos a centavos de dólar con la tasa", () => {
    expect(toUsdCents(2000, "USD", 4000)).toBe(2000);
    expect(toUsdCents(80_000, "COP", 4000)).toBe(2000);
    expect(toUsdCents(80_000, "COP", 0)).toBe(0);
  });

  test("comisión con la tarifa: porcentaje de lo cobrado más el fijo por pago", () => {
    // 3 pagos por 300 USD al 5,4 % + 0,30 USD.
    expect(estimateFeeMinor(30_000, 3, { percent: 0.054, fixed: 0.3 }, "USD")).toBeCloseTo(1620 + 90, 6);
    // 2 pagos por 400.000 COP al 4,75 %, sin fijo.
    expect(estimateFeeMinor(400_000, 2, { percent: 0.0475, fixed: 0 }, "COP")).toBeCloseTo(19_000, 6);
    expect(estimateFeeMinor(0, 0, { percent: 0.054, fixed: 0.3 }, "USD")).toBe(0);
  });

  test("la factura manda sobre lo medido, salvo en las comisiones", () => {
    expect(combineCost("bill-wins", null, null)).toEqual({ usdCents: 0, source: "none" });
    expect(combineCost("bill-wins", null, 150)).toEqual({ usdCents: 150, source: "measured" });
    expect(combineCost("bill-wins", 900, 150)).toEqual({ usdCents: 900, source: "bill" });
    expect(combineCost("bill-wins", 900, null)).toEqual({ usdCents: 900, source: "bill" });
    expect(combineCost("sum", 900, 150)).toEqual({ usdCents: 1050, source: "both" });
    // Un cero medido es un dato («este mes no hubo comisiones»), no una ausencia.
    expect(combineCost("sum", null, 0)).toEqual({ usdCents: 0, source: "measured" });
  });

  test("lo que se teclea en dólares", () => {
    expect(parseAmountInput("20", "USD")).toBe(2000);
    expect(parseAmountInput("20.5", "USD")).toBe(2050);
    expect(parseAmountInput("20,50", "USD")).toBe(2050);
    expect(parseAmountInput("$ 1,234.56", "USD")).toBe(123456);
    expect(parseAmountInput("1,234", "USD")).toBe(123400);
    expect(parseAmountInput("0", "USD")).toBeNull();
    expect(parseAmountInput("", "USD")).toBeNull();
    expect(parseAmountInput("veinte", "USD")).toBeNull();
    expect(parseAmountInput("-5", "USD")).toBeNull();
  });

  test("lo que se teclea en pesos: sin centavos, puntos y comas son miles", () => {
    expect(parseAmountInput("85000", "COP")).toBe(85_000);
    expect(parseAmountInput("85.000", "COP")).toBe(85_000);
    expect(parseAmountInput("$ 1.250.000", "COP")).toBe(1_250_000);
    expect(parseAmountInput("0", "COP")).toBeNull();
    // Como lo imprime una factura: los centavos se descartan, no se multiplican.
    expect(parseAmountInput("85.000,00", "COP")).toBe(85_000);
    expect(parseAmountInput("85000.50", "COP")).toBe(85_000);
    expect(parseAmountInput("1,250,000.00", "COP")).toBe(1_250_000);
    expect(parseAmountInput("0,50", "COP")).toBeNull();
  });

  test("editar una factura vuelve a mostrar lo que se guardó", () => {
    expect(parseAmountInput(amountInputValue(2050, "USD"), "USD")).toBe(2050);
    expect(parseAmountInput(amountInputValue(85_000, "COP"), "COP")).toBe(85_000);
  });

  test("cómo se muestra", () => {
    expect(formatUsdCents(1250)).toBe("$12.50");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(0.2)).toBe("< $0.01");
    expect(formatUsdCents(199.6)).toBe("$2.00");
    expect(formatBillAmount(2000, "USD")).toBe("$20.00 USD");
    expect(formatBillAmount(85_000, "COP")).toBe("$85.000 COP");
  });
});

describe("lo que llega a la API", () => {
  const body = {
    serviceId: "neon",
    label: "  Plan Launch ",
    cadence: "MONTHLY",
    currency: "USD",
    amountMinor: 1900,
    startsOn: "2026-06-03",
    endsOn: "",
    note: "",
  };

  test("un cuerpo válido se limpia", () => {
    expect(parseBillInput(body)).toEqual({
      ok: true,
      data: {
        serviceId: "neon",
        label: "Plan Launch",
        cadence: "MONTHLY",
        currency: "USD",
        amountMinor: 1900,
        startsOn: "2026-06-03",
        endsOn: null,
        note: null,
      },
    });
  });

  test("sin concepto, lleva el nombre del servicio", () => {
    const r = parseBillInput({ ...body, label: "" });
    expect(r.ok && r.data.label).toBe("Neon");
  });

  test("un cobro suelto no guarda fecha de fin", () => {
    const r = parseBillInput({ ...body, cadence: "ONE_TIME", endsOn: "2026-12-01" });
    expect(r.ok && r.data.endsOn).toBeNull();
  });

  test("rechaza lo que no cuadra", () => {
    const error = (over: Record<string, unknown>) => {
      const r = parseBillInput({ ...body, ...over });
      return r.ok ? null : r.error;
    };
    expect(error({ serviceId: "stripe" })).toBe("invalid_service");
    expect(error({ cadence: "WEEKLY" })).toBe("invalid_cadence");
    expect(error({ currency: "EUR" })).toBe("invalid_currency");
    expect(error({ amountMinor: 0 })).toBe("invalid_amount");
    expect(error({ amountMinor: 19.5 })).toBe("invalid_amount");
    expect(error({ amountMinor: "1900" })).toBe("invalid_amount");
    expect(error({ amountMinor: 100_000_001 })).toBe("invalid_amount");
    expect(error({ startsOn: "2026-02-31" })).toBe("invalid_start");
    expect(error({ endsOn: "2026-05-01" })).toBe("invalid_end");
    expect(error({ label: "x".repeat(81) })).toBe("label_too_long");
    expect(error({ note: "x".repeat(301) })).toBe("note_too_long");
    expect(parseBillInput(null)).toEqual({ ok: false, error: "invalid_service" });
  });
});
