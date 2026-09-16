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
});
