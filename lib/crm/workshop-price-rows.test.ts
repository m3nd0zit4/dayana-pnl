import { describe, expect, test } from "bun:test";

import { workshopPriceRowsToWrite, workshopProductIdFor } from "./workshop-price-rows";

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
