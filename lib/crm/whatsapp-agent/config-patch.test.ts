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
