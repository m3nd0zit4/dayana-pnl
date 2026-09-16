import { formatCop } from "@/lib/plans";

// USD con centavos. `formatUsd` de lib/plans redondea a dólares enteros a
// propósito (precios de catálogo como "97 USD"), así que no sirve para mostrar
// lo que se cobró de verdad.
const usdCentsFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Importe cobrado con su moneda, para textos que ve la clienta (factura).
 * COP guarda pesos enteros y se muestra igual que en el catálogo; el resto
 * guarda centavos y se muestra con los dos decimales exactos del cobro.
 */
export const formatAmountWithCurrency = (currency: string, amountMinor: number): string =>
  currency === "COP"
    ? `${formatCop(amountMinor)} COP`
    : `${usdCentsFormatter.format(amountMinor / 100)} ${currency}`;
