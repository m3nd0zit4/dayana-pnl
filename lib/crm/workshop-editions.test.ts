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

  test("cero es válido (precio explícito de cero pesos/dólares)", () => {
    expect(parseWorkshopPriceFields({ priceCop: 0, priceUsd: 0 })).toEqual({
      priceCop: 0,
      priceUsd: 0,
    });
  });

  test("ausente, vacío, negativo, NaN o texto se ignoran", () => {
    expect(parseWorkshopPriceFields({})).toEqual({ priceCop: undefined, priceUsd: undefined });
    expect(parseWorkshopPriceFields({ priceCop: "" })).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
    expect(parseWorkshopPriceFields({ priceCop: -5 })).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
    expect(parseWorkshopPriceFields({ priceUsd: "45.00" })).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
    expect(parseWorkshopPriceFields({ priceCop: Number.NaN })).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
  });

  test("raw no-objeto no revienta", () => {
    expect(parseWorkshopPriceFields(null)).toEqual({ priceCop: undefined, priceUsd: undefined });
    expect(parseWorkshopPriceFields(undefined)).toEqual({
      priceCop: undefined,
      priceUsd: undefined,
    });
  });
});
