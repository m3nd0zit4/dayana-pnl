import { DIAGNOSTIC_QUESTIONS, sanitizeAnswers } from "@/lib/diagnostico/questions";

import type { AnswerDistribution, BreakdownRow, MoneyKpi } from "./dto";
import { averageTicketMinor, minorToUsdEquivalent, type CurrencyTotals } from "./currency";
import { ratio, withDelta } from "./kpi";
import { fillSeries, sumByBucket } from "./series";
import type { SeriesPoint, StatsGranularity } from "./types";

/**
 * Piezas puras de «Ventas e ingresos» y «Embudo del diagnóstico»: constantes,
 * etiquetas y el reacomodo de filas de SQL a los DTO. Sin Prisma ni
 * `server-only`, para poder probarlas con `bun test` sin base de datos.
 */

/**
 * Días tras terminar el diagnóstico en los que una compra aprobada cuenta como
 * «compró tras el diagnóstico». 60 porque una terapia se decide despacio: la
 * persona suele hablar con Dayana, pensarlo y pagar semanas después; con 30
 * días se perdían compras claramente ligadas al diagnóstico.
 */
export const ATTRIBUTION_DAYS = 60;

export const NO_FAILURE_CODE_LABEL = "sin código";
export const NO_COUNTRY_LABEL = "Sin país";
export const NO_SOURCE_LABEL = "Sin origen";
export const NO_PROFILE_LABEL = "Sin perfil";

/** Clave de grupo para los valores nulos (no choca con ningún id real). */
export const NULL_KEY = "__none__";

export const FUNNEL_STEP_LABELS = {
  started: "Empezaron",
  completed: "Terminaron",
  viewedResult: "Vieron el resultado",
  clickedContact: "Pulsaron «Hablar con Dayana»",
  purchased: "Compraron",
} as const;

export const PAYMENT_LINK_STEP_LABELS = {
  created: "Creados",
  opened: "Abiertos",
  checkoutStarted: "Empezaron a pagar",
  paid: "Pagados",
} as const;

/** Filas `{ moneda, valor }` → totales por moneda (suma si se repite la moneda). */
export function totalsByCurrency(
  rows: { currency: string; value: number }[],
): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const row of rows) totals[row.currency] = (totals[row.currency] ?? 0) + row.value;
  return totals;
}

/**
 * Un KPI por cada moneda presente en cualquiera de los dos periodos, ordenado
 * por moneda. Una moneda que solo aparece en el anterior sale con valor 0 (y
 * tendencia a la baja): que desaparezca de la pantalla escondería la caída.
 */
export function mergeMoneyKpis(current: CurrencyTotals, previous: CurrencyTotals): MoneyKpi[] {
  const currencies = [...new Set([...Object.keys(current), ...Object.keys(previous)])].sort();
  return currencies.map((currency) => ({
    currency,
    kpi: withDelta(current[currency] ?? 0, previous[currency] ?? 0),
  }));
}

/** Ticket promedio del periodo actual para cada moneda pedida (null sin pagos). */
export function averageTickets(
  currencies: string[],
  revenue: CurrencyTotals,
  counts: CurrencyTotals,
): { currency: string; valueMinor: number | null }[] {
  return currencies.map((currency) => ({
    currency,
    valueMinor: averageTicketMinor(revenue[currency] ?? 0, counts[currency] ?? 0),
  }));
}

/**
 * Filas diarias por moneda (fecha local "YYYY-MM-DD") → una serie continua por
 * moneda en la granularidad del rango. Monedas ordenadas alfabéticamente.
 */
export function buildSeriesByCurrency(
  rows: { dateKey: string; currency: string; value: number }[],
  keys: string[],
  granularity: StatsGranularity,
): { currency: string; points: SeriesPoint[] }[] {
  const byCurrency = new Map<string, { dateKey: string; value: number }[]>();
  for (const row of rows) {
    const list = byCurrency.get(row.currency) ?? [];
    list.push({ dateKey: row.dateKey, value: row.value });
    byCurrency.set(row.currency, list);
  }
  return [...byCurrency.keys()].sort().map((currency) => ({
    currency,
    points: fillSeries(keys, sumByBucket(byCurrency.get(currency) ?? [], granularity)),
  }));
}

/** Monedas que `minorToUsdEquivalent` sabe convertir. */
const USD_CONVERTIBLE = new Set(["COP", "USD"]);

/**
 * Serie en equivalente USD (unidades mayores, 2 decimales): por cubeta, la
 * suma de cada moneda convertida. Una moneda que no sea COP ni USD se omite en
 * vez de lanzar: la gráfica aproximada no debe tumbar la página entera, y los
 * totales exactos por moneda siguen en `seriesByCurrency`.
 */
export function buildUsdEquivalentSeries(
  seriesByCurrency: { currency: string; points: SeriesPoint[] }[],
  keys: string[],
  usdToCopRate: number,
): SeriesPoint[] {
  const totals = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const { currency, points } of seriesByCurrency) {
    if (!USD_CONVERTIBLE.has(currency)) continue;
    for (const point of points) {
      const current = totals.get(point.key);
      if (current === undefined) continue;
      totals.set(point.key, current + minorToUsdEquivalent(point.value, currency, usdToCopRate));
    }
  }
  return keys.map((key) => ({ key, value: Math.round((totals.get(key) ?? 0) * 100) / 100 + 0 }));
}

type BreakdownInput = { key: string; label: string; value: number; currency?: string };

/**
 * Junta filas con la misma clave (y moneda) sumando su valor. Hace falta
 * cuando un solo `groupBy` por varias columnas alimenta desgloses de una sola
 * dimensión (proveedor y país salen de la misma consulta).
 */
export function mergeBreakdownInputs(rows: BreakdownInput[]): BreakdownInput[] {
  const merged = new Map<string, BreakdownInput>();
  for (const row of rows) {
    const id = `${row.key}:${row.currency ?? ""}`;
    const existing = merged.get(id);
    if (existing) existing.value += row.value;
    else merged.set(id, { ...row });
  }
  return [...merged.values()];
}

let regionNames: Intl.DisplayNames | null | undefined;

/** «CO» → «Colombia»; el código tal cual si el entorno no conoce la región. */
export function countryLabel(iso: string | null): string {
  if (!iso) return NO_COUNTRY_LABEL;
  const code = iso.trim().toUpperCase();
  try {
    regionNames ??= new Intl.DisplayNames(["es"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    regionNames = null;
    return code;
  }
}

/**
 * Distribución de respuestas por pregunta, en el orden del cuestionario y con
 * sus opciones en el orden en que se muestran (no por frecuencia: así la
 * lectura es la misma que la de la persona que lo contestó). Aparecen también
 * las opciones que nadie eligió.
 *
 * - Cada diagnóstico pasa por `sanitizeAnswers`: preguntas u opciones
 *   retiradas del cuestionario (diagnósticos antiguos) se ignoran.
 * - En selección múltiple cuenta cada opción elegida.
 * - `share` = elegida / personas que contestaron esa pregunta. En preguntas de
 *   una respuesta equivale a la proporción del total de respuestas; en
 *   múltiple se lee «el X % de quienes contestaron la eligió» (puede sumar
 *   más de 100 %). Null si nadie la contestó.
 * - Solo preguntas con opciones: escala y texto libre no tienen categorías que
 *   contar (hoy el cuestionario no tiene ninguna).
 */
export function aggregateAnswerDistribution(answersList: unknown[]): AnswerDistribution[] {
  const questions = DIAGNOSTIC_QUESTIONS.filter((q) => (q.options?.length ?? 0) > 0);
  const counts = new Map<string, Map<string, number>>(
    questions.map((q) => [q.id, new Map((q.options ?? []).map((o) => [o.id, 0]))]),
  );
  const respondents = new Map<string, number>(questions.map((q) => [q.id, 0]));

  for (const raw of answersList) {
    const answers: Record<string, string | string[] | undefined> = sanitizeAnswers(raw);
    for (const question of questions) {
      const value = answers[question.id];
      if (value == null) continue;
      const optionCounts = counts.get(question.id);
      if (!optionCounts) continue;
      let answered = false;
      for (const optionId of new Set(Array.isArray(value) ? value : [value])) {
        const current = optionCounts.get(optionId);
        if (current === undefined) continue;
        optionCounts.set(optionId, current + 1);
        answered = true;
      }
      if (answered) respondents.set(question.id, (respondents.get(question.id) ?? 0) + 1);
    }
  }

  return questions.map((question) => {
    const total = respondents.get(question.id) ?? 0;
    const optionCounts = counts.get(question.id);
    const options: BreakdownRow[] = (question.options ?? []).map((option) => {
      const value = optionCounts?.get(option.id) ?? 0;
      return { key: option.id, label: option.label, value, share: ratio(value, total) };
    });
    return { questionId: question.id, question: question.prompt, options };
  });
}
