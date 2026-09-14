import { describe, expect, test } from "bun:test";

import { toBreakdownRows, toFunnelSteps } from "./breakdown";

describe("toBreakdownRows", () => {
  test("proporción dentro del total y orden de mayor a menor", () => {
    const rows = toBreakdownRows([
      { key: "a", label: "A", value: 1 },
      { key: "b", label: "B", value: 3 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["b", "a"]);
    expect(rows[0].share).toBe(0.75);
    expect(rows[1].share).toBe(0.25);
  });

  test("la proporción se calcula dentro de cada moneda", () => {
    const rows = toBreakdownRows([
      { key: "t6-cop", label: "Terapia 6", value: 900_000, currency: "COP" },
      { key: "t1-cop", label: "Terapia 1", value: 100_000, currency: "COP" },
      { key: "t6-usd", label: "Terapia 6", value: 30_000, currency: "USD" },
    ]);
    expect(rows.find((r) => r.key === "t6-cop")?.share).toBe(0.9);
    expect(rows.find((r) => r.key === "t6-usd")?.share).toBe(1);
    expect(rows.map((r) => r.currency)).toEqual(["COP", "COP", "USD"]);
  });

  test("total 0 da proporción null; etiqueta por función; límite", () => {
    const rows = toBreakdownRows(
      [
        { key: "x", value: 0 },
        { key: "y", value: 0 },
      ],
      { labelFor: (k) => `Etiqueta ${k}`, limit: 1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].share).toBeNull();
    expect(rows[0].label.startsWith("Etiqueta")).toBe(true);
  });
});

describe("toFunnelSteps", () => {
  test("conversión desde el anterior y desde el primero", () => {
    const steps = toFunnelSteps([
      { key: "start", label: "Empezaron", count: 100 },
      { key: "done", label: "Terminaron", count: 60 },
      { key: "bought", label: "Compraron", count: 6 },
    ]);
    expect(steps[0].conversionFromPrevious).toBeNull();
    expect(steps[1].conversionFromPrevious).toBe(0.6);
    expect(steps[2].conversionFromPrevious).toBe(0.1);
    expect(steps[2].conversionFromStart).toBe(0.06);
  });

  test("un paso anterior en 0 no divide por cero", () => {
    const steps = toFunnelSteps([
      { key: "a", label: "A", count: 0 },
      { key: "b", label: "B", count: 0 },
    ]);
    expect(steps[1].conversionFromPrevious).toBeNull();
    expect(steps[1].conversionFromStart).toBeNull();
  });
});
