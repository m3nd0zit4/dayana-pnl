import { describe, expect, test } from "bun:test";

import {
  validateWorkshopPrices,
  workshopPriceRowsToWrite,
  workshopProductIdFor,
} from "./workshop-price-rows";

describe("workshopPriceRowsToWrite", () => {
  const none = { cop: null, usd: null };

  test("primera vez: escribe las dos monedas", () => {
    expect(workshopPriceRowsToWrite(none, { copPesos: 180000, usdCents: 4500 })).toEqual([
      { currency: "COP", amountMinor: 180000 },
      { currency: "USD", amountMinor: 4500 },
    ]);
  });

  test("mismo precio: no añade filas al histórico", () => {
    expect(
      workshopPriceRowsToWrite({ cop: 180000, usd: 4500 }, { copPesos: 180000, usdCents: 4500 }),
    ).toEqual([]);
  });

  test("sólo cambia una moneda", () => {
    expect(
      workshopPriceRowsToWrite({ cop: 180000, usd: 4500 }, { copPesos: 200000, usdCents: 4500 }),
    ).toEqual([{ currency: "COP", amountMinor: 200000 }]);
  });

  test("precio vacío deja la moneda como estaba", () => {
    expect(workshopPriceRowsToWrite({ cop: 180000, usd: 4500 }, { copPesos: null })).toEqual([]);
    expect(workshopPriceRowsToWrite({ cop: 180000, usd: 4500 }, {})).toEqual([]);
  });

  test("valores inválidos se ignoran: cero, negativos y decimales", () => {
    expect(workshopPriceRowsToWrite(none, { copPesos: 0, usdCents: -5 })).toEqual([]);
    expect(workshopPriceRowsToWrite(none, { copPesos: 1800.5 })).toEqual([]);
  });
});

describe("workshopProductIdFor", () => {
  test("id legible a partir del slug", () => {
    expect(workshopProductIdFor("saca-tu-mejor-version")).toBe("taller-saca-tu-mejor-version");
  });
});

describe("validateWorkshopPrices", () => {
  test("precios validos: COP entero y USD a centavos", () => {
    expect(validateWorkshopPrices({ priceCop: 180000, priceUsd: 45.5 })).toEqual({
      ok: true,
      copPesos: 180000,
      usdCents: 4550,
    });
  });

  test("sin precios: valido y sin cambios", () => {
    expect(validateWorkshopPrices({})).toEqual({ ok: true, copPesos: undefined, usdCents: undefined });
  });

  test("rechaza cero, pesos con decimales y dolares con mas de dos decimales", () => {
    expect(validateWorkshopPrices({ priceCop: 0 }).ok).toBe(false);
    expect(validateWorkshopPrices({ priceCop: 180000.5 }).ok).toBe(false);
    expect(validateWorkshopPrices({ priceUsd: 0 }).ok).toBe(false);
    expect(validateWorkshopPrices({ priceUsd: 45.555 }).ok).toBe(false);
    expect(validateWorkshopPrices({ priceCop: Number.NaN }).ok).toBe(false);
    expect(validateWorkshopPrices({ priceCop: 1e12 }).ok).toBe(false);
    expect(validateWorkshopPrices({ priceUsd: 1e9 }).ok).toBe(false);
  });

  test("dolares tipicos con flotante impreciso se aceptan", () => {
    expect(validateWorkshopPrices({ priceUsd: 19.99 })).toEqual({
      ok: true,
      copPesos: undefined,
      usdCents: 1999,
    });
  });
});
