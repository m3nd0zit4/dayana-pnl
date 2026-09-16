import { describe, expect, test } from "bun:test";

import { formatCop } from "@/lib/plans";

import { formatAmountWithCurrency } from "./money-display";

describe("formatAmountWithCurrency", () => {
  test("COP: igual que el catálogo, pesos enteros", () => {
    expect(formatAmountWithCurrency("COP", 189900)).toBe(`${formatCop(189900)} COP`);
  });

  test("USD: muestra los centavos exactos del cobro", () => {
    expect(formatAmountWithCurrency("USD", 1050)).toBe("$10.50 USD");
    expect(formatAmountWithCurrency("USD", 1049)).toBe("$10.49 USD");
    expect(formatAmountWithCurrency("USD", 3087)).toBe("$30.87 USD");
  });

  test("USD entero lleva .00 y separador de miles", () => {
    expect(formatAmountWithCurrency("USD", 9700)).toBe("$97.00 USD");
    expect(formatAmountWithCurrency("USD", 123456)).toBe("$1,234.56 USD");
  });

  test("bordes: cero, un centavo y montos grandes", () => {
    expect(formatAmountWithCurrency("USD", 0)).toBe("$0.00 USD");
    expect(formatAmountWithCurrency("USD", 1)).toBe("$0.01 USD");
    expect(formatAmountWithCurrency("USD", 999999999)).toBe("$9,999,999.99 USD");
  });

  test("negativo (una devolución) conserva el signo", () => {
    expect(formatAmountWithCurrency("USD", -1050)).toBe("-$10.50 USD");
  });

  // Hoy no existen filas fuera de COP/USD (PayPal cobra en USD, Mercado Pago
  // en COP y el registro manual sólo ofrece esas dos), pero el símbolo sale
  // del formateador en USD: la etiqueta dice la moneda real.
  test("otra moneda: símbolo de dólar y etiqueta de la moneda, como antes", () => {
    expect(formatAmountWithCurrency("EUR", 5000)).toBe("$50.00 EUR");
  });
});
