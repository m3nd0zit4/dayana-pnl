import { describe, expect, test } from "bun:test";

import { compareToBaseline, suspectBroken, withConfirmation, type Baseline, type EvalReport } from "./gate";

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

describe("confirmar un caso roto", () => {
  test("solo son sospechosos los que pasaban k de k y ahora nunca", () => {
    expect(suspectBroken(report({ a: 0, b: 1, c: 0, d: 0 }), baseline)).toEqual(["a"]);
    expect(suspectBroken(report({ a: 0 }), null)).toEqual([]);
  });
  test("si en la segunda corrida pasa alguna vez, no está roto", () => {
    const first = report({ a: 0, b: 2, c: 0, d: 1 });
    const merged = withConfirmation(first, report({ a: 1 }));
    expect(compareToBaseline(merged, baseline, { k: 2 }).ok).toBe(true);
    expect(merged.results.find((r) => r.id === "a")?.runs.length).toBe(2);
  });
  test("si tampoco pasa en la segunda corrida, se rompió", () => {
    const merged = withConfirmation(report({ a: 0, b: 2, c: 0, d: 1 }), report({ a: 0 }));
    expect(compareToBaseline(merged, baseline, { k: 2 }).ok).toBe(false);
  });
  test("texto interno en la segunda corrida tampoco pasa", () => {
    const merged = withConfirmation(report({ a: 0, b: 2, c: 0, d: 1 }), report({ a: 4 }, ["se filtró texto interno"]));
    expect(compareToBaseline(merged, baseline, { k: 2 }).ok).toBe(false);
  });
});
