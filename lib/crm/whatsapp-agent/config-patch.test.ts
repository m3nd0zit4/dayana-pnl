import { describe, expect, test } from "bun:test";

import { deepMerge } from "./config-patch";

describe("deepMerge", () => {
  test("mezcla objetos por nivel y reemplaza listas", () => {
    const base = { a: 1, booking: { bufferMin: 15, hours: [1, 2], addMeet: true } };
    const out = deepMerge(base, { booking: { bufferMin: 30, hours: [3] } });
    expect(out).toEqual({ a: 1, booking: { bufferMin: 30, hours: [3], addMeet: true } });
    expect(base.booking.bufferMin).toBe(15);
  });

  test("ignora undefined", () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});

import { diffConfig } from "./config-diff";

describe("guardar ajustes no pisa cambios de otra pantalla", () => {
  test("solo manda lo que cambió", () => {
    const before = { defaultMode: "AUTO", schedule: { mode: "always", days: [1, 2] }, maxPerDay: 6 };
    const after = { defaultMode: "AUTO", schedule: { mode: "outside_hours", days: [1, 2] }, maxPerDay: 6 };
    expect(diffConfig(before, after)).toEqual({ schedule: { mode: "outside_hours" } });
  });
  test("una lista se manda entera; sin cambios no manda nada", () => {
    expect(diffConfig({ days: [1, 2] }, { days: [1, 2, 3] })).toEqual({ days: [1, 2, 3] });
    expect(diffConfig({ a: 1 }, { a: 1 })).toBeUndefined();
  });
  test("mezclado sobre lo actual conserva el cambio hecho en otra pantalla", () => {
    const current = { defaultMode: "COPILOT", schedule: { mode: "always" } }; // otra pantalla puso COPILOT
    const patch = diffConfig({ defaultMode: "AUTO", schedule: { mode: "always" } }, { defaultMode: "AUTO", schedule: { mode: "outside_hours" } });
    expect(deepMerge(current, patch)).toEqual({ defaultMode: "COPILOT", schedule: { mode: "outside_hours" } });
  });
});
