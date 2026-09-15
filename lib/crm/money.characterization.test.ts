import { describe, expect, test } from "bun:test";

import {
  formatMoneyMinor,
  isZeroDecimalCurrency,
  majorToMinor,
  minorToMajor,
} from "./money";
import { formatCop, formatUsd } from "../plans";

describe("isZeroDecimalCurrency", () => {
  test("sólo COP es de cero decimales", () => {
    expect(isZeroDecimalCurrency("COP")).toBe(true);
    expect(isZeroDecimalCurrency("USD")).toBe(false);
    expect(isZeroDecimalCurrency("EUR")).toBe(false);
    // characterization: current behaviour, see report — la comparación es
    // estricta e insensible-a-mayúsculas NO aplicada: "cop" en minúscula no
    // cuenta como cero-decimal.
    expect(isZeroDecimalCurrency("cop")).toBe(false);
  });
});

describe("minorToMajor / majorToMinor", () => {
  test("COP: unidad menor === unidad mayor (sin conversión)", () => {
    expect(minorToMajor(189900, "COP")).toBe(189900);
    expect(majorToMinor(189900, "COP")).toBe(189900);
  });

  test("COP redondea a entero incluso si llega con decimales", () => {
    expect(majorToMinor(189900.6, "COP")).toBe(189901);
  });

  test("USD: unidad menor son centavos, se divide/multiplica por 100", () => {
    expect(minorToMajor(1050, "USD")).toBe(10.5);
    expect(majorToMinor(10.5, "USD")).toBe(1050);
  });

  test("USD boundary: 1 centavo y 0", () => {
    expect(minorToMajor(1, "USD")).toBe(0.01);
    expect(minorToMajor(0, "USD")).toBe(0);
    expect(majorToMinor(0, "USD")).toBe(0);
  });

  test("USD: majorToMinor redondea (no trunca) resultados de punto flotante imprecisos", () => {
    // characterization: current behaviour, see report — 19.999 * 100 no da
    // 1999.9 exacto en punto flotante (da 1999.8999999999999); Math.round lo
    // lleva a 2000, así que el resultado sale bien aquí, pero por Math.round
    // arreglando el error, no porque el cálculo intermedio fuera exacto.
    expect(majorToMinor(19.999, "USD")).toBe(2000);
  });

  test("cualquier moneda distinta de COP se trata como de 2 decimales (igual que USD)", () => {
    expect(minorToMajor(1050, "EUR")).toBe(10.5);
    expect(majorToMinor(10.5, "MXN")).toBe(1050);
  });
});

describe("formatMoneyMinor", () => {
  test("COP: separador de miles es-CO y sin decimales", () => {
    expect(formatMoneyMinor(189900, "COP")).toBe("189.900");
    expect(formatMoneyMinor(1000000, "COP")).toBe("1.000.000");
    expect(formatMoneyMinor(0, "COP")).toBe("0");
    expect(formatMoneyMinor(1, "COP")).toBe("1");
  });

  test("USD: toFixed(2) SIEMPRE muestra 2 decimales, sin separador de miles", () => {
    expect(formatMoneyMinor(1050, "USD")).toBe("10.50");
    expect(formatMoneyMinor(100, "USD")).toBe("1.00");
    expect(formatMoneyMinor(1, "USD")).toBe("0.01");
    expect(formatMoneyMinor(0, "USD")).toBe("0.00");
  });

  test("USD boundary: montos grandes no llevan separador de miles (a diferencia de COP)", () => {
    // characterization: current behaviour, see report — formatMoneyMinor para
    // no-COP usa `major.toFixed(2)`, que no agrupa miles. "123456.78" en vez
    // de "123,456.78". Distinto criterio de formato entre COP (Intl-like con
    // separador) y USD (toFixed plano) dentro de la MISMA función.
    expect(formatMoneyMinor(12345678, "USD")).toBe("123456.78");
  });
});

// La factura de socia (`app/cuenta/facturacion/page.tsx`) define su propio
// `formatAmount` local que llama a estas mismas funciones de lib/plans, con
// una diferencia clave respecto a `formatMoneyMinor`: para USD divide entre
// 100 y pasa el resultado por `formatUsd`, que trunca a 0 decimales.
const facturacionFormatAmount = (currency: string, amountMinor: number) =>
  currency === "COP"
    ? `${formatCop(amountMinor)} COP`
    : `${formatUsd(amountMinor / 100)} ${currency}`;

describe("formatCop / formatUsd (lib/plans.ts)", () => {
  test("formatCop: símbolo y separador es-CO, sin decimales", () => {
    // characterization: current behaviour, see report — Intl.NumberFormat
    // ("es-CO", currency) intercala un ESPACIO DURO (U+00A0), no un espacio
    // normal, entre el símbolo "$" y la cifra.
    expect(formatCop(189900)).toBe("$ 189.900");
    expect(formatCop(0)).toBe("$ 0");
    expect(formatCop(1)).toBe("$ 1");
  });

  test("formatUsd: SIEMPRE redondea a dólares enteros (maximumFractionDigits: 0)", () => {
    // characterization: current behaviour, see report — a diferencia de
    // `formatMoneyMinor`, que preserva los centavos con `toFixed(2)`,
    // `formatUsd` (usado tal cual en el catálogo de planes, donde los precios
    // ya son enteros como "97 USD") DESCARTA cualquier centavo si se le pasa
    // un monto con decimales.
    expect(formatUsd(97)).toBe("$97");
    expect(formatUsd(0)).toBe("$0");
  });

  test("formatUsd con decimales: redondea (half-up aparente) al entero más cercano", () => {
    expect(formatUsd(10.49)).toBe("$10");
    expect(formatUsd(10.5)).toBe("$11");
    expect(formatUsd(10.51)).toBe("$11");
  });
});

describe("formatAmount de app/cuenta/facturacion — el problema de los centavos en USD", () => {
  test("COP: formatCop recibe amountMinor TAL CUAL (ya es la unidad mayor)", () => {
    expect(facturacionFormatAmount("COP", 189900)).toBe("$ 189.900 COP");
  });

  test("USD sin centavos: amountMinor/100 y formatUsd coinciden sin pérdida visible", () => {
    expect(facturacionFormatAmount("USD", 9700)).toBe("$97 USD");
  });

  // characterization: current behaviour, see report — BUG aparente. Un pago de
  // 10.50 USD (amountMinor = 1050) se muestra en la factura de la socia como
  // "$11 USD": formatUsd(1050 / 100) = formatUsd(10.5), y formatUsd trunca a
  // enteros (maximumFractionDigits: 0 en el Intl.NumberFormat de lib/plans.ts).
  // Los centavos reales cobrados desaparecen de la vista de la clienta, y el
  // redondeo puede incluso cambiar la cifra mostrada. `formatMoneyMinor` (usado
  // en otras partes del CRM) NO tiene este problema porque usa toFixed(2).
  test("USD con centavos: la factura de socia OCULTA y REDONDEA los centavos (BUG)", () => {
    expect(facturacionFormatAmount("USD", 1050)).toBe("$11 USD");
    // El monto realmente cobrado, mostrado sin pérdida por la otra función:
    expect(formatMoneyMinor(1050, "USD")).toBe("10.50");
  });

  test("USD con centavos que redondean hacia abajo: 10.49 se ve como 10, no como 10.49", () => {
    expect(facturacionFormatAmount("USD", 1049)).toBe("$10 USD");
  });
});
