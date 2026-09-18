/**
 * Qué filas de `ProductPrice` hay que escribir al guardar el precio de una
 * edición de taller. Pura, para probarla sin base de datos.
 *
 * `ProductPrice` es un histórico: el precio vigente es la fila más reciente
 * por moneda. Guardar la edición sin tocar el precio no debe añadir filas
 * (el histórico se llenaría de cambios que no lo son), y un precio vacío no
 * borra el anterior: deja la moneda como estaba.
 *
 * Unidades, igual que en todo el proyecto: COP en pesos enteros, USD en
 * centavos.
 */

export type WorkshopPriceInput = {
  /** Pesos enteros. `null`/`undefined` = no cambiar. */
  copPesos?: number | null;
  /** Centavos de dólar. `null`/`undefined` = no cambiar. */
  usdCents?: number | null;
};

export type CurrentPrices = {
  cop: number | null;
  usd: number | null;
};

export type PriceRow = { currency: "COP" | "USD"; amountMinor: number };

const valid = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0;

export function workshopPriceRowsToWrite(
  current: CurrentPrices,
  next: WorkshopPriceInput,
): PriceRow[] {
  const rows: PriceRow[] = [];
  if (valid(next.copPesos) && next.copPesos !== current.cop) {
    rows.push({ currency: "COP", amountMinor: next.copPesos });
  }
  if (valid(next.usdCents) && next.usdCents !== current.usd) {
    rows.push({ currency: "USD", amountMinor: next.usdCents });
  }
  return rows;
}

/** Id del producto propio de una edición. Legible, como el resto (`therapy-6`). */
export const workshopProductIdFor = (slug: string): string => `taller-${slug}`;

export type ValidatedWorkshopPrices =
  | { ok: true; copPesos?: number; usdCents?: number }
  | { ok: false };

/**
 * Valida los precios que llegan del formulario. COP en pesos enteros mayores
 * que cero; USD en dolares mayores que cero con maximo dos decimales (se
 * devuelve en centavos). `undefined` = no se escribio, no cambia nada.
 *
 * Antes un 0 o un `180000.5` se aceptaban y se descartaban en silencio: el
 * formulario decia «guardado» y el precio no cambiaba.
 */
export function validateWorkshopPrices(input: {
  priceCop?: number;
  priceUsd?: number;
}): ValidatedWorkshopPrices {
  const { priceCop, priceUsd } = input;
  if (priceCop !== undefined && !(Number.isInteger(priceCop) && priceCop > 0)) {
    return { ok: false };
  }
  let usdCents: number | undefined;
  if (priceUsd !== undefined) {
    const cents = Math.round(priceUsd * 100);
    if (!(priceUsd > 0) || Math.abs(cents - priceUsd * 100) > 1e-6) return { ok: false };
    usdCents = cents;
  }
  return { ok: true, copPesos: priceCop, usdCents };
}
