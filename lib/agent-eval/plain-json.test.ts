import { describe, expect, test } from "bun:test";
import { plainJson } from "@/agent/lib/plain-json";

describe("salida de herramientas en JSON puro", () => {
  test("fechas a ISO, bigint a número, undefined fuera", () => {
    const out = plainJson({ at: new Date("2026-11-08T10:00:00Z"), n: BigInt(5), big: BigInt("9007199254740993"), gone: undefined, list: [new Date(0)] });
    expect(out).toEqual({ at: "2026-11-08T10:00:00.000Z", n: 5, big: "9007199254740993", list: ["1970-01-01T00:00:00.000Z"] } as never);
  });
  test("lo que ya es JSON queda igual", () => {
    const v = { a: 1, b: "x", c: [true, null] };
    expect(plainJson(v)).toEqual(v);
  });
});
