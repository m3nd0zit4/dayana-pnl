/**
 * Datos de muestra de «Estadísticas» para `isCrmUiPreview()` (dev local sin
 * base de datos). Un fixture fijo por área, con series de 30 días de
 * granularidad diaria — el preset por defecto (`30d`) — construidas con el
 * mismo `bucketKeys` que usa `parseStatsRange`, así las claves del eje X
 * coinciden siempre con lo que pintaría la consulta real.
 *
 * Los importes están en unidades menores: COP en pesos enteros, USD en
 * centavos (ver `lib/crm/money.ts`).
 */

import { toBreakdownRows, toFunnelSteps } from "./breakdown";
import { withDelta } from "./kpi";
import { bucketKeys, parseStatsRange } from "./range";
import type {
  ContentStats,
  FunnelStats,
  PeopleStats,
  SalesStats,
} from "./dto";
import { DEFAULT_OPERATIONAL_TZ } from "@/lib/datetime/zoned-time";

const RANGE = parseStatsRange({ period: "30d" }, DEFAULT_OPERATIONAL_TZ, new Date());
const DAY_KEYS = bucketKeys(RANGE);

/** Onda suave y determinista para que la serie tenga forma sin ser aleatoria. */
const wave = (base: number, amplitude: number, i: number): number =>
  Math.max(0, Math.round(base + amplitude * Math.sin(i / 2.3) + (i % 5 === 0 ? amplitude * 0.6 : 0)));

const series = (base: number, amplitude: number) =>
  DAY_KEYS.map((key, i) => ({ key, value: wave(base, amplitude, i) }));

// ---------------------------------------------------------------- Ventas

const salesCopSeries = series(620_000, 380_000);
const salesUsdSeries = series(28, 18); // centavos-no, valor en dólares para el equivalente

const PREVIEW_SALES: SalesStats = {
  revenue: [
    { currency: "COP", kpi: withDelta(18_650_000, 15_920_000) },
    { currency: "USD", kpi: withDelta(214_000, 198_500) },
  ],
  net: [
    { currency: "COP", kpi: withDelta(17_430_000, 14_980_000) },
    { currency: "USD", kpi: withDelta(198_900, 184_200) },
  ],
  paymentsWithoutFee: 3,
  approvedCount: withDelta(46, 39),
  averageTicket: [
    { currency: "COP", valueMinor: 405_435 },
    { currency: "USD", valueMinor: 8_920 },
  ],
  failureRate: { value: 0.081, previous: 0.113 },
  topFailureCodes: toBreakdownRows(
    [
      { key: "cc_rejected_insufficient_amount", value: 9, currency: "" },
      { key: "cc_rejected_bad_filled_card_number", value: 4, currency: "" },
      { key: "cc_rejected_call_for_authorize", value: 2, currency: "" },
    ],
    {
      labelFor: (key) =>
        ({
          cc_rejected_insufficient_amount: "Fondos insuficientes",
          cc_rejected_bad_filled_card_number: "Número de tarjeta incorrecto",
          cc_rejected_call_for_authorize: "Requiere autorización del banco",
        })[key] ?? key,
    },
  ),
  refundedFromPeriod: 1,
  usdEquivalentSeries: salesUsdSeries,
  seriesByCurrency: [
    { currency: "COP", points: salesCopSeries },
    { currency: "USD", points: series(720, 340) },
  ],
  byProduct: toBreakdownRows([
    { key: "terapia-individual", label: "Terapia individual", value: 7_200_000, currency: "COP" },
    { key: "terapia-6-sesiones", label: "Terapia · 6 sesiones", value: 6_100_000, currency: "COP" },
    { key: "membresia-mensual", label: "Membresía mensual", value: 3_350_000, currency: "COP" },
    { key: "taller-duelo", label: "Taller de duelo", value: 2_000_000, currency: "COP" },
    { key: "curso-ansiedad", label: "Curso de ansiedad", value: 118_000, currency: "USD" },
    { key: "membresia-mensual-usd", label: "Membresía mensual", value: 96_000, currency: "USD" },
  ]),
  byProvider: toBreakdownRows([
    { key: "MERCADO_PAGO", label: "Mercado Pago", value: 14_100_000, currency: "COP" },
    { key: "MANUAL", label: "Manual", value: 4_550_000, currency: "COP" },
    { key: "PAYPAL", label: "PayPal", value: 214_000, currency: "USD" },
  ]),
  byCountry: toBreakdownRows([
    { key: "CO", label: "Colombia", value: 32, currency: "" },
    { key: "MX", label: "México", value: 6, currency: "" },
    { key: "US", label: "Estados Unidos", value: 5, currency: "" },
    { key: "ES", label: "España", value: 3, currency: "" },
  ]),
  promo: {
    redemptions: withDelta(11, 7),
    discountByCurrency: [
      { currency: "COP", minor: 1_240_000 },
      { currency: "USD", minor: 9_500 },
    ],
  },
  paymentLinks: toFunnelSteps([
    { key: "created", label: "Creados", count: 58 },
    { key: "opened", label: "Abiertos", count: 41 },
    { key: "checkout_started", label: "Empezaron a pagar", count: 27 },
    { key: "paid", label: "Pagados", count: 19 },
  ]),
  usdToCopRate: 3_900,
};

// ---------------------------------------------------------------- Embudo

const PREVIEW_FUNNEL: FunnelStats = {
  // Mismos pasos que `getFunnelStats`: la compra no es un paso anidado, va en
  // el KPI `purchased` (se puede comprar sin pulsar «Hablar con Dayana»).
  steps: toFunnelSteps([
    { key: "started", label: "Empezaron", count: 312 },
    { key: "completed", label: "Terminaron", count: 224 },
    { key: "viewedResult", label: "Vieron el resultado", count: 198 },
    { key: "clickedContact", label: "Pulsaron «Hablar con Dayana»", count: 96 },
  ]),
  completed: withDelta(224, 187),
  purchased: withDelta(41, 33),
  // Origen del diagnóstico (`source` de la página donde empezó), no el origen
  // del contacto; y perfil del resultado, no el foco elegido.
  bySource: toBreakdownRows([
    { key: "enlaces", label: "Página de enlaces", value: 118 },
    { key: "ad", label: "Anuncio", value: 64 },
    { key: "home", label: "Inicio", value: 22 },
    { key: "historias", label: "Historias", value: 12 },
    { key: "__none__", label: "Sin origen", value: 8 },
  ]),
  byProfile: toBreakdownRows([
    { key: "EN_PROCESO", label: "En proceso", value: 91 },
    { key: "EXPLORADOR", label: "Explorador", value: 63 },
    { key: "RAIZ_PROFUNDA", label: "Raíz profunda", value: 44 },
    { key: "EN_EXPANSION", label: "En expansión", value: 26 },
  ]),
  answerDistribution: [
    {
      questionId: "orientacion",
      question: "¿Qué buscas ahora mismo?",
      options: toBreakdownRows([
        { key: "pesa", label: "Algo me pesa y quiero soltarlo", value: 141, currency: "" },
        { key: "avanzar", label: "Quiero avanzar hacia algo", value: 83, currency: "" },
      ]),
    },
    {
      questionId: "tiempo",
      question: "¿Hace cuánto sientes esto?",
      options: toBreakdownRows([
        { key: "semanas", label: "Unas semanas", value: 52, currency: "" },
        { key: "meses", label: "Varios meses", value: 96, currency: "" },
        { key: "anios", label: "Años", value: 61, currency: "" },
        { key: "siempre", label: "Desde siempre", value: 15, currency: "" },
      ]),
    },
    {
      questionId: "modalidad",
      question: "¿Cómo prefieres trabajar esto?",
      options: toBreakdownRows([
        { key: "individual", label: "Terapia individual", value: 132, currency: "" },
        { key: "grupo", label: "En grupo", value: 47, currency: "" },
        { key: "autonomo", label: "A mi ritmo, sola", value: 45, currency: "" },
      ]),
    },
  ],
  attributionDays: 60,
};

// ------------------------------------------------------------ Contactos

const PREVIEW_PEOPLE: PeopleStats = {
  newContacts: withDelta(87, 74),
  newContactsSeries: series(3, 2),
  contactsBySource: toBreakdownRows([
    { key: "INSTAGRAM", label: "Instagram", value: 39, currency: "" },
    { key: "TIKTOK", label: "TikTok", value: 22, currency: "" },
    { key: "WEB", label: "Web", value: 14, currency: "" },
    { key: "WHATSAPP_DIRECT", label: "WhatsApp directo", value: 8, currency: "" },
    { key: "REFERRAL", label: "Referido", value: 4, currency: "" },
  ]),
  contactsByCountry: toBreakdownRows([
    { key: "CO", label: "Colombia", value: 58, currency: "" },
    { key: "MX", label: "México", value: 12, currency: "" },
    { key: "US", label: "Estados Unidos", value: 9, currency: "" },
    { key: "ES", label: "España", value: 5, currency: "" },
    { key: "AR", label: "Argentina", value: 3, currency: "" },
  ]),
  marketingConsentRate: 0.72,
  members: { active: 214, expiringThisWeek: 9, expired: 17 },
  newPaidMembers: withDelta(23, 18),
  renewals: withDelta(31, 27),
  subscriptionsByStatus: toBreakdownRows([
    { key: "ACTIVE", label: "Activas", value: 214, currency: "" },
    { key: "SUSPENDED", label: "Suspendidas", value: 6, currency: "" },
    { key: "CANCELLED", label: "Canceladas", value: 12, currency: "" },
    { key: "EXPIRED", label: "Vencidas", value: 17, currency: "" },
  ]),
  subscriptionsByProvider: toBreakdownRows([
    { key: "MERCADO_PAGO", label: "Mercado Pago", value: 172, currency: "" },
    { key: "PAYPAL", label: "PayPal", value: 61, currency: "" },
    { key: "MANUAL", label: "Manual", value: 16, currency: "" },
  ]),
  pipeline: toBreakdownRows([
    { key: "LEAD", label: "Leads", value: 46, currency: "" },
    { key: "PENDING_PAYMENT", label: "Pago pendiente", value: 12, currency: "" },
    { key: "ACTIVE", label: "Activos", value: 214, currency: "" },
    { key: "COMPLETED", label: "Completados", value: 58, currency: "" },
    { key: "CANCELLED", label: "Cancelados", value: 9, currency: "" },
    { key: "REFUNDED", label: "Reembolsados", value: 3, currency: "" },
  ]),
};

// -------------------------------------------------------------- Contenido

const PREVIEW_CONTENT: ContentStats = {
  webinar: {
    registrations: withDelta(164, 141),
    registrationsSeries: series(6, 4),
    byEdition: toBreakdownRows([
      { key: "ed-14-sep", label: "Edición 14 sep.", value: 61, currency: "" },
      { key: "ed-21-sep", label: "Edición 21 sep.", value: 58, currency: "" },
      { key: "ed-28-sep", label: "Edición 28 sep.", value: 45, currency: "" },
    ]),
    reminderFailures: 2,
    registrantsWhoPurchased: 27,
  },
  workshops: {
    editions: [
      { key: "taller-duelo-sep", label: "Taller de duelo · sep.", startsAt: "2026-09-20T15:00:00.000Z", seatsSold: 18, capacity: 20 },
      { key: "taller-ansiedad-oct", label: "Taller de ansiedad · oct.", startsAt: "2026-10-04T15:00:00.000Z", seatsSold: 12, capacity: 20 },
      { key: "taller-autoestima-oct", label: "Taller de autoestima · oct.", startsAt: null, seatsSold: 6, capacity: null },
    ],
  },
  courses: {
    classCompletions: withDelta(96, 81),
    completionsSeries: series(3, 2),
    moduleCompletion: toBreakdownRows([
      { key: "modulo-1", label: "Módulo 1 · Fundamentos", value: 88, currency: "" },
      { key: "modulo-2", label: "Módulo 2 · Regulación emocional", value: 71, currency: "" },
      { key: "modulo-3", label: "Módulo 3 · Vínculos", value: 54, currency: "" },
      { key: "modulo-4", label: "Módulo 4 · Integración", value: 39, currency: "" },
    ]),
    quizPassRate: 0.83,
    quizAttempts: 112,
    comments: withDelta(64, 52),
  },
};

export const PREVIEW_STATS = {
  ventas: PREVIEW_SALES,
  embudo: PREVIEW_FUNNEL,
  contactos: PREVIEW_PEOPLE,
  contenido: PREVIEW_CONTENT,
} as const;
