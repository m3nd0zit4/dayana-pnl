import { buildCostsMonth, type CostBill, type CostsMonth, type MonthFacts } from "./build";
import { monthsEndingAt, resolveMonth } from "./rules";

/**
 * Datos de mentira para la vista previa del CRM (`CRM_UI_PREVIEW`, sin base de
 * datos). Pasan por el mismo `buildCostsMonth` que los reales, y enseñan cada
 * caso que la pantalla sabe pintar: facturado, calculado, plan fijo, algo
 * apuntado a mano, una clave que falta y un precio que falta.
 */

const PREVIEW_CURRENT_MONTH = "2026-11";

const BILLS: CostBill[] = [
  { id: "fixed:whatsapp:0", serviceId: "whatsapp", label: "Licencia de 360dialog", cadence: "MONTHLY", currency: "USD", amountMinor: 5300, startsOn: "2026-09-01", endsOn: null, note: null, fixed: true },
  { id: "fixed:upstash:0", serviceId: "upstash", label: "Plan de Upstash", cadence: "MONTHLY", currency: "USD", amountMinor: 0, startsOn: "2026-06-01", endsOn: null, note: null, fixed: true },
  { id: "prev-otro", serviceId: "otro", label: "Micrófono para las clases", cadence: "ONE_TIME", currency: "COP", amountMinor: 180_000, startsOn: "2026-11-04", endsOn: null, note: null },
];

const facts = (scale: number): MonthFacts => ({
  measured: {
    vercel: { usdCents: 2000, kind: "exact" },
    dominio: { usdCents: 150, kind: "estimate" },
    neon: { usdCents: 1240 * scale, kind: "estimate" },
    gemini: { usdCents: 1860 * scale, kind: "estimate" },
  },
  activity: {
    dominio: "dayanabeltran.com · vence el 28 abr 2027 · renovación automática apagada",
    neon: "98,4 horas de cómputo · 1,3 GB guardados",
    gemini: "4.210 llamadas a la IA · gemini-3.5-flash sin tarifa publicada: contado al precio de flash-lite",
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
    status: {
      mux: { state: "missing_key", message: "Falta pegar MUX_TOKEN_ID y MUX_TOKEN_SECRET en las variables de entorno de Vercel." },
      resend: { state: "missing_price", message: "Falta el precio del plan. Se escribe una vez en la configuración y cuenta solo cada mes." },
    },
  });
};
