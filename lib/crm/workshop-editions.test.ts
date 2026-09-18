import { describe, expect, test } from "bun:test";

import { latestPricesFromRows, parseWorkshopPriceFields } from "./workshop-editions";

describe("latestPricesFromRows", () => {
  test("sin filas: sin precio en ninguna moneda", () => {
    expect(latestPricesFromRows([])).toEqual({ cop: null, usd: null });
  });

  test("toma la primera fila de cada moneda — la lista debe venir ordenada por validFrom desc", () => {
    expect(
      latestPricesFromRows([
        { currency: "COP", amountMinor: 200000 },
        { currency: "USD", amountMinor: 5000 },
        { currency: "COP", amountMinor: 180000 },
      ])
    ).toEqual({ cop: 200000, usd: 5000 });
  });

  test("sólo una moneda con histórico", () => {
    expect(
      latestPricesFromRows([{ currency: "COP", amountMinor: 180000 }])
    ).toEqual({ cop: 180000, usd: null });
  });
});

describe("parseWorkshopPriceFields", () => {
  test("números válidos se leen tal cual", () => {
    expect(parseWorkshopPriceFields({ priceCop: 180000, priceUsd: 45 })).toEqual({
      priceCop: 180000,
      priceUsd: 45,
    });
  });

  test("cero se lee tal cual (la validación es la que lo rechaza)", () => {
    expect(parseWorkshopPriceFields({ priceCop: 0, priceUsd: 0 })).toEqual({
      priceCop: 0,
      priceUsd: 0,
    });
  });

  test("ausente o vacío: no se escribió, se ignora", () => {
    expect(parseWorkshopPriceFields({})).toEqual({ priceCop: undefined, priceUsd: undefined });
    expect(parseWorkshopPriceFields({ priceCop: "", priceUsd: null })).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
  });

  // Antes se ignoraban en silencio y el formulario decía «guardado» sin
  // cambiar nada. Ahora llegan como NaN y `validateWorkshopPrices` los
  // rechaza con `invalid_price`.
  test("negativo, NaN o texto llegan como NaN para que la validación los rechace", () => {
    expect(Number.isNaN(parseWorkshopPriceFields({ priceCop: -5 }).priceCop)).toBe(true);
    expect(Number.isNaN(parseWorkshopPriceFields({ priceUsd: "45.00" }).priceUsd)).toBe(true);
    expect(Number.isNaN(parseWorkshopPriceFields({ priceCop: Number.NaN }).priceCop)).toBe(true);
  });

  test("raw no-objeto no revienta", () => {
    expect(parseWorkshopPriceFields(null)).toEqual({ priceCop: undefined, priceUsd: undefined });
    expect(parseWorkshopPriceFields(undefined)).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
  });
});
