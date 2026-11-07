import { describe, expect, test } from "bun:test";

import { dedupeBlocks, deltaInfo, formatAxisValue, formatCell, formatChartLabel, formatChartValue } from "./display-format";

describe("formatChartValue", () => {
  test("money in minor units: COP whole pesos, USD cents", () => {
    expect(formatChartValue({ type: "money", currency: "COP" }, 1250000)).toBe("1.250.000 COP");
    expect(formatChartValue({ type: "money", currency: "USD" }, 12999)).toBe("129.99 USD");
  });

  test("percent and count", () => {
    expect(formatChartValue({ type: "percent" }, 0.38)).toBe("38 %");
    expect(formatChartValue({ type: "percent" }, 0.045)).toBe("4,5 %");
    expect(formatChartValue({ type: "count" }, 1234)).toBe("1.234");
    expect(formatChartValue({ type: "count" }, Number.NaN)).toBe("—");
  });
});

describe("formatAxisValue", () => {
  test("compact ticks", () => {
    expect(formatAxisValue({ type: "money", currency: "USD" }, 150000)).toBe(formatAxisValue({ type: "count" }, 1500));
    expect(formatAxisValue({ type: "percent" }, 0.355)).toBe("36 %");
    expect(formatAxisValue({ type: "count" }, 12)).toBe("12");
  });
});

describe("deltaInfo", () => {
  test("direction and sign", () => {
    expect(deltaInfo(0.12)).toEqual({ text: "+12 %", direction: "up" });
    expect(deltaInfo(-0.034)).toEqual({ text: "−3,4 %", direction: "down" });
    expect(deltaInfo(0.001)).toEqual({ text: "0 %", direction: "flat" });
    expect(deltaInfo(null)).toBeNull();
    expect(deltaInfo(undefined)).toBeNull();
  });
});

describe("blocks", () => {
  test("identical blocks draw once", () => {
    const block = { kind: "kpis" as const, items: [{ label: "Ventas", value: "3" }] };
    expect(dedupeBlocks([block, { ...block }, { kind: "kpis" as const, items: [] }])).toHaveLength(2);
  });

  test("cells", () => {
    expect(formatCell(1234.5)).toBe("1.234,5");
    expect(formatCell("Ana")).toBe("Ana");
  });
});

describe("formatChartLabel", () => {
  test("days and months read as Spanish dates", () => {
    expect(formatChartLabel("2026-10-09")).toBe("9 oct");
    expect(formatChartLabel("2026-01")).toBe("ene 2026");
    expect(formatChartLabel("Primer Paso")).toBe("Primer Paso");
  });
});
