import type { Kpi, SeriesPoint, StatsArea, StatsRange } from "./types";

/**
 * Formas de datos de «Estadísticas», compartidas por las consultas
 * (`sales.ts`, `funnel.ts`, `people.ts`, `content.ts`), los datos de muestra
 * (`preview.ts`) y la interfaz (`app/components/admin/crm/stats/**`).
 *
 * Todo es serializable (números, strings, arrays): viaja del servidor al
 * cliente tal cual. Los importes van SIEMPRE en unidades menores de su moneda
 * —pesos enteros en COP, centavos en USD— y nunca se suman monedas distintas.
 */

/** Un importe por moneda, comparado con el periodo anterior (en unidades menores). */
export type MoneyKpi = { currency: string; kpi: Kpi };

/** Fila de desglose: «Terapia 6 sesiones · 1.200.000 COP · 40 %». */
export type BreakdownRow = {
  key: string;
  label: string;
  /** Cantidad o importe en unidades menores (si lleva `currency`). */
  value: number;
  /** Proporción 0–1 dentro de su grupo (misma moneda), o null si el total es 0. */
  share: number | null;
  currency?: string;
};

/** Un paso de un embudo, con la conversión desde el paso anterior y desde el primero. */
export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  conversionFromPrevious: number | null;
  conversionFromStart: number | null;
};

export type SalesStats = {
  /** Cobrado aprobado (por `paidAt`) en cada moneda. */
  revenue: MoneyKpi[];
  /** Neto después de comisiones, sólo con pagos que tienen `feeMinor`. */
  net: MoneyKpi[];
  /** Pagos aprobados del periodo sin comisión conocida (p. ej. manuales). */
  paymentsWithoutFee: number;
  approvedCount: Kpi;
  averageTicket: { currency: string; valueMinor: number | null }[];
  /** FAILED / (APPROVED + FAILED), por `createdAt`. */
  failureRate: { value: number | null; previous: number | null };
  topFailureCodes: BreakdownRow[];
  /** Pagos aprobados en el periodo que hoy figuran como reembolsados. */
  refundedFromPeriod: number;
  /** Serie de ingresos en equivalente USD a la tasa configurada. */
  usdEquivalentSeries: SeriesPoint[];
  /** Serie de ingresos por moneda, en unidades menores. */
  seriesByCurrency: { currency: string; points: SeriesPoint[] }[];
  byProduct: BreakdownRow[];
  byProvider: BreakdownRow[];
  byCountry: BreakdownRow[];
  promo: {
    redemptions: Kpi;
    discountByCurrency: { currency: string; minor: number }[];
  };
  /** Enlaces de pago creados en el periodo → abiertos → empezaron a pagar → pagados. */
  paymentLinks: FunnelStep[];
  usdToCopRate: number;
};

export type AnswerDistribution = {
  questionId: string;
  question: string;
  options: BreakdownRow[];
};

export type FunnelStats = {
  /** Empezaron → terminaron → vieron el resultado → «Hablar con Dayana» (anidados). */
  steps: FunnelStep[];
  completed: Kpi;
  /**
   * Terminados en el periodo que compraron dentro de `attributionDays`, por el
   * camino que sea (con o sin «Hablar con Dayana»). Va aparte del embudo: como
   * paso anidado dejaba fuera a quien compró sin ese clic.
   */
  purchased: Kpi;
  bySource: BreakdownRow[];
  byProfile: BreakdownRow[];
  answerDistribution: AnswerDistribution[];
  /** Días tras terminar el diagnóstico en los que una compra cuenta como suya. */
  attributionDays: number;
};

export type PeopleStats = {
  newContacts: Kpi;
  newContactsSeries: SeriesPoint[];
  contactsBySource: BreakdownRow[];
  contactsByCountry: BreakdownRow[];
  /** Proporción de contactos nuevos del periodo con consentimiento de marketing. */
  marketingConsentRate: number | null;
  members: { active: number; expiringThisWeek: number; expired: number };
  newPaidMembers: Kpi;
  renewals: Kpi;
  subscriptionsByStatus: BreakdownRow[];
  subscriptionsByProvider: BreakdownRow[];
  pipeline: BreakdownRow[];
};

export type ContentStats = {
  webinar: {
    registrations: Kpi;
    registrationsSeries: SeriesPoint[];
    byEdition: BreakdownRow[];
    reminderFailures: number;
    registrantsWhoPurchased: number;
  };
  workshops: {
    editions: {
      key: string;
      label: string;
      /** ISO. */
      startsAt: string | null;
      seatsSold: number;
      capacity: number | null;
    }[];
  };
  courses: {
    classCompletions: Kpi;
    completionsSeries: SeriesPoint[];
    moduleCompletion: BreakdownRow[];
    quizPassRate: number | null;
    quizAttempts: number;
    comments: Kpi;
  };
};

/** `StatsRange` con las fechas ya en ISO, para pasarlo al cliente. */
export type SerializableStatsRange = Omit<StatsRange, "from" | "to" | "prevFrom" | "prevTo"> & {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
};

export type StatsPayload =
  | { area: Extract<StatsArea, "ventas">; data: SalesStats }
  | { area: Extract<StatsArea, "embudo">; data: FunnelStats }
  | { area: Extract<StatsArea, "contactos">; data: PeopleStats }
  | { area: Extract<StatsArea, "contenido">; data: ContentStats };

export const serializeStatsRange = (range: StatsRange): SerializableStatsRange => ({
  ...range,
  from: range.from.toISOString(),
  to: range.to.toISOString(),
  prevFrom: range.prevFrom.toISOString(),
  prevTo: range.prevTo.toISOString(),
});
