/**
 * Utilidades de moneda para Estadísticas.
 *
 * Los importes viven en unidades menores tal como se guardan: COP en pesos
 * enteros (moneda sin decimales) y USD en centavos — ver `lib/crm/money.ts`.
 * Los totales nunca se suman entre monedas; la equivalencia en USD es una
 * línea aparte y aproximada.
 */

/** Totales por moneda en unidades menores, p. ej. `{ COP: 350000, USD: 12345 }`. */
export type CurrencyTotals = Record<string, number>;

/**
 * Normaliza lo que devuelve Postgres vía `$queryRaw`: `COUNT`/`SUM` de enteros
 * llegan como `bigint` y `SUM` de numeric como string. null (SUM sin filas)
 * es 0. Lanza con valores no finitos, strings no numéricos o bigint fuera del
 * rango entero seguro de `number` (perdería precisión en silencio).
 */
export function toNumber(value: bigint | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "bigint") {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error(`UNSAFE_BIGINT: ${value}`);
    }
    return Number(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
    if (!Number.isFinite(parsed)) throw new Error(`NON_FINITE_NUMBER: ${value}`);
    return parsed;
  }
  if (!Number.isFinite(value)) throw new Error(`NON_FINITE_NUMBER: ${value}`);
  return value;
}

/** Suma unidades menores a una moneda; devuelve un objeto nuevo (no muta). */
export function addMinor(
  totals: CurrencyTotals,
  currency: string,
  minor: bigint | number | string | null
): CurrencyTotals {
  return { ...totals, [currency]: (totals[currency] ?? 0) + toNumber(minor) };
}

const round2 = (value: number): number => Math.round(value * 100) / 100 + 0;

/**
 * Equivalente aproximado en dólares (unidades mayores, 2 decimales).
 * USD: centavos ÷ 100. COP: pesos enteros ÷ tasa COP por USD.
 * Cualquier otra moneda lanza: el CRM solo cobra en COP y USD, y convertir
 * otra con una tasa inventada daría un total falso sin que nadie lo note.
 * También lanza si la tasa COP no es un número positivo.
 */
export function minorToUsdEquivalent(
  minor: number,
  currency: string,
  usdToCopRate: number
): number {
  if (currency === "USD") return round2(minor / 100);
  if (currency === "COP") {
    if (!Number.isFinite(usdToCopRate) || usdToCopRate <= 0) {
      throw new Error(`INVALID_USD_TO_COP_RATE: ${usdToCopRate}`);
    }
    return round2(minor / usdToCopRate);
  }
  throw new Error(`UNSUPPORTED_CURRENCY: ${currency}`);
}

/** Ticket promedio en unidades menores enteras; null si no hubo pagos. */
export function averageTicketMinor(totalMinor: number, count: number): number | null {
  if (count === 0) return null;
  return Math.round(totalMinor / count) + 0;
}
