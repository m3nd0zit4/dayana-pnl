import { buildCostsMonth, type CostBill, type CostsMonth, type MonthFacts } from "./build";
import { monthsEndingAt, resolveMonth } from "./rules";

/**
 * Datos de mentira para la vista previa del CRM (`CRM_UI_PREVIEW`, sin base de
 * datos). Pasan por el mismo `buildCostsMonth` que los reales.
 */

const PREVIEW_CURRENT_MONTH = "2026-11";

const BILLS: CostBill[] = [
  { id: "prev-vercel", serviceId: "vercel", label: "Plan Pro", cadence: "MONTHLY", currency: "USD", amountMinor: 2000, startsOn: "2026-06-01", endsOn: null, note: null },
  { id: "prev-neon", serviceId: "neon", label: "Plan Launch", cadence: "MONTHLY", currency: "USD", amountMinor: 1900, startsOn: "2026-06-03", endsOn: null, note: null },
  { id: "prev-whatsapp", serviceId: "whatsapp", label: "Licencia 360dialog", cadence: "MONTHLY", currency: "USD", amountMinor: 5300, startsOn: "2026-09-01", endsOn: null, note: null },
  { id: "prev-dominio", serviceId: "dominio", label: "dayanabeltran.com", cadence: "YEARLY", currency: "USD", amountMinor: 1800, startsOn: "2026-03-10", endsOn: null, note: null },
];

const facts = (scale: number): MonthFacts => ({
  measured: {
    gemini: { usdCents: 940 * scale, kind: "estimate" },
    paypal: { usdCents: 3120 * scale, kind: "estimate" },
    mercadopago: { usdCents: 1850 * scale, kind: "exact", copMinor: Math.round(74_000 * scale) },
  },
  activity: {
    gemini: "1.240 respuestas de WhatsApp",
    paypal: "14 pagos · comisión según la tarifa (5,4 % + 0,30 USD)",
    mercadopago: "9 pagos",
    resend: "761 correos enviados",
    whatsapp: "71 plantillas en envíos masivos",
  },
});

export const previewCostsMonth = (requested: unknown): CostsMonth => {
  const month = resolveMonth(requested, PREVIEW_CURRENT_MONTH);
  const months = monthsEndingAt(month, 6);
  return buildCostsMonth({
    month,
    currentMonth: PREVIEW_CURRENT_MONTH,
    months,
    usdToCop: 4000,
    bills: BILLS,
    // Cada mes un poco más que el anterior, para que la tendencia no sea una raya.
    factsByMonth: Object.fromEntries(months.map((m, i) => [m, facts(0.5 + i * 0.1)])),
  });
};
