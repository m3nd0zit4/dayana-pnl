import { describe, expect, test } from "bun:test";

import { formatDeltaLabel, ratio, withDelta } from "./kpi";

describe("withDelta", () => {
  test("0 → 0: sin delta, estable", () => {
    expect(withDelta(0, 0)).toEqual({ value: 0, previous: 0, delta: null, trend: "flat" });
  });

  test("0 → 5: sin delta, sube", () => {
    expect(withDelta(5, 0)).toEqual({ value: 5, previous: 0, delta: null, trend: "up" });
  });

  test("5 → 0: −100 %, baja", () => {
    expect(withDelta(0, 5)).toEqual({ value: 0, previous: 5, delta: -1, trend: "down" });
  });

  test("10 → 12: +20 %", () => {
    expect(withDelta(12, 10)).toEqual({ value: 12, previous: 10, delta: 0.2, trend: "up" });
  });

  test("12 → 10: −16,67 %", () => {
    expect(withDelta(10, 12)).toEqual({
      value: 10,
      previous: 12,
      delta: -0.1667,
      trend: "down",
    });
  });

  test("redondea a 4 decimales", () => {
    expect(withDelta(1, 3).delta).toBe(-0.6667);
    expect(withDelta(2, 3).delta).toBe(-0.3333);
    expect(withDelta(4, 3).delta).toBe(0.3333);
  });

  test("banda estable |delta| < 0,005", () => {
    expect(withDelta(1004, 1000).trend).toBe("flat"); // +0,4 %
    expect(withDelta(996, 1000).trend).toBe("flat"); // −0,4 %
    expect(withDelta(1005, 1000).trend).toBe("up"); // +0,5 %
    expect(withDelta(995, 1000).trend).toBe("down"); // −0,5 %
    expect(withDelta(1000, 1000)).toEqual({
      value: 1000,
      previous: 1000,
      delta: 0,
      trend: "flat",
    });
  });

  test("igual sin -0", () => {
    expect(Object.is(withDelta(7, 7).delta, 0)).toBe(true);
  });

  test("anterior negativo: el signo sigue la dirección", () => {
    expect(withDelta(-5, -10)).toMatchObject({ delta: 0.5, trend: "up" });
  });
});

describe("ratio", () => {
  test("denominador 0 → null", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
  });
  test("redondea a 4 decimales", () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(2, 3)).toBe(0.6667);
    expect(ratio(5, 10)).toBe(0.5);
    expect(ratio(0, 7)).toBe(0);
  });
});

describe("formatDeltaLabel", () => {
  test("positivo con decimal", () => {
    expect(formatDeltaLabel(0.125)).toBe("+12,5 %");
  });
  test("negativo entero con signo menos U+2212", () => {
    expect(formatDeltaLabel(-0.03)).toBe("−3 %");
  });
  test("sin decimales si es entero", () => {
    expect(formatDeltaLabel(0.2)).toBe("+20 %");
    expect(formatDeltaLabel(-1)).toBe("−100 %");
  });
  test("un decimal como máximo", () => {
    expect(formatDeltaLabel(-0.1667)).toBe("−16,7 %");
    expect(formatDeltaLabel(0.3333)).toBe("+33,3 %");
  });
  test("cero y valores que redondean a cero", () => {
    expect(formatDeltaLabel(0)).toBe("0 %");
    expect(formatDeltaLabel(0.0004)).toBe("0 %");
    expect(formatDeltaLabel(-0.0004)).toBe("0 %");
  });
  test("null o no finito → raya", () => {
    expect(formatDeltaLabel(null)).toBe("—");
    expect(formatDeltaLabel(Number.NaN)).toBe("—");
    expect(formatDeltaLabel(Number.POSITIVE_INFINITY)).toBe("—");
  });
  test("combina con withDelta", () => {
    expect(formatDeltaLabel(withDelta(12, 10).delta)).toBe("+20 %");
    expect(formatDeltaLabel(withDelta(5, 0).delta)).toBe("—");
  });
});
