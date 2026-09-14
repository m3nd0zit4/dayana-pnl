import { describe, expect, test } from "bun:test";

import { formatMoneyMinor, minorToMajor } from "@/lib/crm/money";

import { addMinor, averageTicketMinor, minorToUsdEquivalent, toNumber } from "./currency";

describe("toNumber", () => {
  test("bigint (COUNT/SUM de Postgres)", () => {
    expect(toNumber(BigInt(0))).toBe(0);
    expect(toNumber(BigInt(350000))).toBe(350000);
    expect(toNumber(BigInt(-1200))).toBe(-1200);
  });
  test("string numérico (SUM de numeric)", () => {
    expect(toNumber("12345")).toBe(12345);
    expect(toNumber(" 42 ")).toBe(42);
    expect(toNumber("12.5")).toBe(12.5);
  });
  test("null / undefined → 0", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });
  test("number pasa tal cual", () => {
    expect(toNumber(7)).toBe(7);
  });
  test("no finitos o no numéricos lanzan", () => {
    expect(() => toNumber(Number.NaN)).toThrow();
    expect(() => toNumber(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => toNumber("abc")).toThrow();
    expect(() => toNumber("")).toThrow();
    expect(() => toNumber("Infinity")).toThrow();
  });
  test("bigint fuera del rango seguro lanza", () => {
    expect(() => toNumber(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1))).toThrow();
    expect(toNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("addMinor", () => {
  test("no muta el objeto original", () => {
    const original = { COP: 100000 };
    const next = addMinor(original, "COP", BigInt(250000));
    expect(next).toEqual({ COP: 350000 });
    expect(original).toEqual({ COP: 100000 });
    expect(next).not.toBe(original);
  });
  test("añade una moneda nueva sin mezclar", () => {
    let totals = {};
    totals = addMinor(totals, "COP", "350000");
    totals = addMinor(totals, "USD", 12345);
    totals = addMinor(totals, "USD", null);
    expect(totals).toEqual({ COP: 350000, USD: 12345 });
  });
});

describe("minorToUsdEquivalent", () => {
  test("USD en centavos → dólares", () => {
    expect(minorToUsdEquivalent(12345, "USD", 3500)).toBe(123.45);
    expect(minorToUsdEquivalent(0, "USD", 3500)).toBe(0);
  });
  test("COP en pesos enteros ÷ tasa", () => {
    expect(minorToUsdEquivalent(350000, "COP", 3500)).toBe(100);
    expect(minorToUsdEquivalent(100000, "COP", 3900)).toBe(25.64);
  });
  test("COP no se divide por 100 (moneda sin decimales)", () => {
    // 350.000 pesos: lo mismo que muestra money.ts, no 3.500.
    expect(minorToMajor(350000, "COP")).toBe(350000);
    expect(formatMoneyMinor(350000, "COP")).toBe((350000).toLocaleString("es-CO"));
    expect(minorToUsdEquivalent(350000, "COP", 3500)).not.toBe(1);
  });
  test("moneda no soportada lanza", () => {
    expect(() => minorToUsdEquivalent(1000, "EUR", 3500)).toThrow("UNSUPPORTED_CURRENCY");
  });
  test("tasa COP inválida lanza", () => {
    expect(() => minorToUsdEquivalent(1000, "COP", 0)).toThrow();
    expect(() => minorToUsdEquivalent(1000, "COP", Number.NaN)).toThrow();
    // La tasa no importa para USD.
    expect(minorToUsdEquivalent(1000, "USD", 0)).toBe(10);
  });
});

describe("averageTicketMinor", () => {
  test("sin pagos → null", () => {
    expect(averageTicketMinor(0, 0)).toBeNull();
    expect(averageTicketMinor(5000, 0)).toBeNull();
  });
  test("redondea a unidades menores enteras", () => {
    expect(averageTicketMinor(350000, 2)).toBe(175000);
    expect(averageTicketMinor(10000, 3)).toBe(3333);
    expect(averageTicketMinor(20000, 3)).toBe(6667);
    expect(averageTicketMinor(0, 4)).toBe(0);
  });
});
