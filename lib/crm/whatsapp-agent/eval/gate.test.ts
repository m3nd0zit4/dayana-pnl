import { describe, expect, test } from "bun:test";

import { compareToBaseline, type Baseline, type EvalReport } from "./gate";

const baseline: Baseline = { date: "2026-11-22", k: 2, model: "x", cases: { a: 2, b: 2, c: 0, d: 1 } };
const report = (passes: Record<string, number>, failed: string[] = []): EvalReport => ({
  results: Object.entries(passes).map(([id, p]) => ({ id, passes: p, runs: [{ failed }] })),
});

describe("puerta de evaluación", () => {
  test("igual o mejor que la línea base: pasa", () => {
    expect(compareToBaseline(report({ a: 2, b: 1, c: 1, d: 0 }), baseline, { k: 2 }).ok).toBe(true);
  });
  test("un caso que pasaba siempre ahora nunca: no pasa", () => {
    const v = compareToBaseline(report({ a: 0, b: 2, c: 0, d: 1 }), baseline, { k: 2 });
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toContain("Se rompieron");
  });
  test("texto interno en lo que recibiría la persona: nunca pasa, ni sin línea base", () => {
    expect(compareToBaseline(report({ a: 2 }, ["se filtró texto interno"]), null, { k: 2 }).ok).toBe(false);
  });
  test("el total baja más de lo tolerado: no pasa", () => {
    const big: Baseline = { ...baseline, cases: { a: 1, b: 1, c: 1, d: 1, e: 1 } };
    expect(compareToBaseline(report({ a: 1, b: 0, c: 0, d: 0, e: 1 }), big, { k: 2 }).ok).toBe(false);
    expect(compareToBaseline(report({ a: 1, b: 0, c: 0, d: 1, e: 1 }), big, { k: 2 }).ok).toBe(true);
  });
});
