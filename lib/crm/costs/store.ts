// Sin `server-only`, como `lib/crm/stats/*`: así el agente del panel puede
// leer los costos el día que haga falta sin que el paquete lance al cargarse.

import { prisma } from "@/lib/db";
import { getDateKeyInTz, getStartOfDayInTz } from "@/lib/datetime/zoned-time";
import { OPERATIONAL_TZ, getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";
import { mercadoPagoFee, paypalFee } from "@/lib/pricing/fees";
import { estimateUsd } from "@/lib/crm/whatsapp-agent/spend";

import { buildCostsMonth, type CostBill, type CostsMonth, type MonthFacts } from "./build";
import {
  COST_CADENCES,
  COST_CURRENCIES,
  addMonths,
  estimateFeeMinor,
  monthsEndingAt,
  resolveMonth,
  toUsdCents,
  type BillInput,
  type CostCadence,
  type CostCurrency,
} from "./rules";

/**
 * Los costos de la plataforma con la base de datos.
 *
 * Dos fuentes:
 *
 *  - **Facturas** (`platform_costs`): lo que alguien registró a mano.
 *  - **Medido**: lo que ya está en otras tablas. Las comisiones salen de
 *    `payments.fee_minor` cuando el pago la trae (exacto). Hoy ninguna vía de
 *    cobro la guarda —`recordPayment` la acepta, pero nadie se la pasa—, así
 *    que para esos pagos se calcula con la tarifa configurada
 *    (`paypalFee` / `mercadoPagoFee`: porcentaje de lo cobrado más el fijo) y
 *    se marca como aproximada. La IA sale de `whatsapp_ai_runs` con el precio de lista
 *    (`estimateUsd`): es una aproximación y solo cubre las respuestas de
 *    WhatsApp — las fichas, las notas de voz, la clasificación de chats y el
 *    asistente del panel no dejan registro de lo que gastan.
 *
 * Todo se agrupa por mes en la zona de Dayana. Las columnas son TIMESTAMP sin
 * zona guardadas en UTC: se marcan como UTC y luego se llevan a la zona (ver
 * `lib/crm/dashboard-stats.ts`).
 */

/** Meses que enseña la tendencia, contando el mostrado. */
export const TREND_MONTHS = 6;

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const dateFromKey = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

/** El primer instante de un mes en la zona operativa. */
const monthStart = (monthKey: string, timeZone: string): Date => {
  const [y, m] = monthKey.split("-").map(Number);
  return getStartOfDayInTz(new Date(Date.UTC(y, m - 1, 1, 12)), timeZone);
};

/** «5,4 % + 0,30 USD» / «4,75 %»: la tarifa con la que se calculó. */
const feeLabel = (id: "paypal" | "mercadopago"): string => {
  const fee = id === "paypal" ? paypalFee() : mercadoPagoFee();
  const percent = `${(fee.percent * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`;
  if (fee.fixed <= 0) return percent;
  const fixed = fee.fixed.toLocaleString("es-CO", { minimumFractionDigits: id === "paypal" ? 2 : 0 });
  return `${percent} + ${fixed} ${id === "paypal" ? "USD" : "COP"}`;
};

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;

type BillRecord = {
  id: string;
  serviceId: string;
  label: string;
  cadence: string;
  currency: string;
  amountMinor: number;
  startsOn: Date;
  endsOn: Date | null;
  note: string | null;
};

const toBill = (row: BillRecord): CostBill => ({
  id: row.id,
  serviceId: row.serviceId,
  label: row.label,
  // Son columnas de texto: un valor que no esté en la lista (alguien lo tocó a
  // mano) se lee como lo más conservador en vez de romper la pantalla.
  cadence: (COST_CADENCES as readonly string[]).includes(row.cadence) ? (row.cadence as CostCadence) : "ONE_TIME",
  currency: (COST_CURRENCIES as readonly string[]).includes(row.currency) ? (row.currency as CostCurrency) : "USD",
  amountMinor: row.amountMinor,
  startsOn: dateKey(row.startsOn),
  endsOn: row.endsOn ? dateKey(row.endsOn) : null,
  note: row.note,
});

export const listBills = async (): Promise<CostBill[]> => {
  const rows = await prisma.platformCost.findMany({ orderBy: { startsOn: "asc" } });
  return rows.map(toBill);
};

const billData = (input: BillInput) => ({
  serviceId: input.serviceId,
  label: input.label,
  cadence: input.cadence,
  currency: input.currency,
  amountMinor: input.amountMinor,
  startsOn: dateFromKey(input.startsOn),
  endsOn: input.endsOn ? dateFromKey(input.endsOn) : null,
  note: input.note,
});

export const createBill = async (input: BillInput, staffUserId: string): Promise<CostBill> =>
  toBill(await prisma.platformCost.create({ data: { ...billData(input), createdById: staffUserId } }));

/** `null` si la factura ya no existe. */
export const updateBill = async (id: string, input: BillInput): Promise<CostBill | null> => {
  const { count } = await prisma.platformCost.updateMany({ where: { id }, data: billData(input) });
  if (count === 0) return null;
  const row = await prisma.platformCost.findUnique({ where: { id } });
  return row ? toBill(row) : null;
};

/** `false` si la factura ya no existía. */
export const deleteBill = async (id: string): Promise<boolean> => {
  const { count } = await prisma.platformCost.deleteMany({ where: { id } });
  return count > 0;
};

// ── Lo medido ───────────────────────────────────────────────────────────────

type FeeRow = {
  month: string;
  provider: string;
  currency: string;
  fee: bigint;
  payments: bigint;
  with_fee: bigint;
  /** Lo cobrado en los pagos que no traen comisión. */
  amount_without_fee: bigint;
};
type AiRow = { month: string; model: string | null; input: bigint; output: bigint; cached: bigint; runs: bigint };
type DeliveryRow = { month: string; channel: string; n: bigint };
type TemplateRow = { month: string; n: bigint };

const measuredFacts = async (
  from: Date,
  to: Date,
  timeZone: string,
  usdToCop: number,
): Promise<Record<string, MonthFacts>> => {
  const [fees, ai, deliveries, templates] = await Promise.all([
    prisma.$queryRaw<FeeRow[]>`
      SELECT
        to_char((("paid_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month,
        "provider"::text AS provider,
        "currency"::text AS currency,
        COALESCE(SUM("fee_minor"), 0)::bigint AS fee,
        COUNT(*)::bigint AS payments,
        COUNT("fee_minor")::bigint AS with_fee,
        COALESCE(SUM("amount_minor") FILTER (WHERE "fee_minor" IS NULL), 0)::bigint AS amount_without_fee
      FROM "payments"
      WHERE "status" = 'APPROVED'
        AND "provider" IN ('PAYPAL', 'MERCADO_PAGO')
        AND "paid_at" >= ${from} AND "paid_at" < ${to}
      GROUP BY 1, 2, 3
    `,
    prisma.$queryRaw<AiRow[]>`
      SELECT
        to_char((("queued_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month,
        "model" AS model,
        COALESCE(SUM("input_tokens"), 0)::bigint AS input,
        COALESCE(SUM("output_tokens"), 0)::bigint AS output,
        COALESCE(SUM("cached_tokens"), 0)::bigint AS cached,
        COUNT(*)::bigint AS runs
      FROM "whatsapp_ai_runs"
      WHERE "model" IS NOT NULL
        AND "queued_at" >= ${from} AND "queued_at" < ${to}
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<DeliveryRow[]>`
      SELECT
        to_char((("created_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month,
        "channel"::text AS channel,
        COUNT(*)::bigint AS n
      FROM "notification_deliveries"
      WHERE "status" = 'SENT'
        AND "channel" IN ('EMAIL', 'SMS')
        AND "created_at" >= ${from} AND "created_at" < ${to}
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<TemplateRow[]>`
      SELECT
        to_char((("processed_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month,
        COUNT(*)::bigint AS n
      FROM "whatsapp_send_recipients"
      WHERE "status" = 'SENT'
        AND "mode" = 'template'
        AND "processed_at" >= ${from} AND "processed_at" < ${to}
      GROUP BY 1
    `,
  ]);

  const byMonth: Record<string, MonthFacts> = {};
  const factsOf = (month: string): MonthFacts => (byMonth[month] ??= { measured: {}, activity: {} });

  // Comisiones. Una pasarela puede traer más de una moneda en el mismo mes
  // (no debería): se suman en dólares y los pesos se guardan aparte.
  const feeTotals = new Map<string, { usdCents: number; copMinor: number; payments: number; withFee: number }>();
  for (const row of fees) {
    const id = row.provider === "PAYPAL" ? "paypal" : "mercadopago";
    const key = `${row.month}|${id}`;
    const total = feeTotals.get(key) ?? { usdCents: 0, copMinor: 0, payments: 0, withFee: 0 };
    const currency: CostCurrency = row.currency.trim() === "COP" ? "COP" : "USD";
    const missing = Number(row.payments) - Number(row.with_fee);
    const fee =
      Number(row.fee) +
      estimateFeeMinor(Number(row.amount_without_fee), missing, id === "paypal" ? paypalFee() : mercadoPagoFee(), currency);
    total.usdCents += toUsdCents(fee, currency, usdToCop);
    if (currency === "COP") total.copMinor += fee;
    total.payments += Number(row.payments);
    total.withFee += Number(row.with_fee);
    feeTotals.set(key, total);
  }
  for (const [key, total] of feeTotals) {
    const [month, id] = key.split("|") as [string, "paypal" | "mercadopago"];
    const facts = factsOf(month);
    facts.measured[id] = {
      usdCents: total.usdCents,
      // Exacta solo si todos los pagos del mes traen su comisión.
      kind: total.withFee === total.payments ? "exact" : "estimate",
      ...(total.copMinor > 0 ? { copMinor: Math.round(total.copMinor) } : {}),
    };
    facts.activity[id] =
      plural(total.payments, "pago", "pagos") +
      (total.withFee < total.payments ? ` · comisión según la tarifa (${feeLabel(id)})` : "");
  }

  // IA: tokens por modelo, al precio de lista.
  const aiTotals = new Map<string, { usd: number; runs: number }>();
  for (const row of ai) {
    const total = aiTotals.get(row.month) ?? { usd: 0, runs: 0 };
    total.usd += estimateUsd(
      { inputTokens: Number(row.input), cachedTokens: Number(row.cached), outputTokens: Number(row.output) },
      row.model,
    );
    total.runs += Number(row.runs);
    aiTotals.set(row.month, total);
  }
  for (const [month, total] of aiTotals) {
    const facts = factsOf(month);
    facts.measured.gemini = { usdCents: total.usd * 100, kind: "estimate" };
    facts.activity.gemini = plural(total.runs, "respuesta de WhatsApp", "respuestas de WhatsApp");
  }

  for (const row of deliveries) {
    const n = Number(row.n);
    if (row.channel === "EMAIL") factsOf(row.month).activity.resend = plural(n, "correo enviado", "correos enviados");
    if (row.channel === "SMS") factsOf(row.month).activity.twilio = plural(n, "SMS enviado", "SMS enviados");
  }
  for (const row of templates) {
    factsOf(row.month).activity.whatsapp = plural(
      Number(row.n),
      "plantilla en envíos masivos",
      "plantillas en envíos masivos",
    );
  }

  return byMonth;
};

/** El mes actual en la zona de Dayana, `YYYY-MM`. */
export const currentCostsMonth = async (now: Date = new Date()): Promise<string> => {
  const timeZone = await getOperationalTimezone().catch(() => OPERATIONAL_TZ);
  return getDateKeyInTz(now, timeZone).slice(0, 7);
};

/** Todo lo que pinta la pantalla para un mes (`requested`: lo que venga en la URL). */
export const getCostsMonth = async (requested: unknown, now: Date = new Date()): Promise<CostsMonth> => {
  const timeZone = await getOperationalTimezone().catch(() => OPERATIONAL_TZ);
  const currentMonth = getDateKeyInTz(now, timeZone).slice(0, 7);
  const month = resolveMonth(requested, currentMonth);
  const months = monthsEndingAt(month, TREND_MONTHS);
  const usdToCop = await resolveUsdToCopRate();

  const [bills, factsByMonth] = await Promise.all([
    listBills(),
    measuredFacts(monthStart(months[0], timeZone), monthStart(addMonths(month, 1), timeZone), timeZone, usdToCop),
  ]);

  return buildCostsMonth({ month, currentMonth, months, usdToCop, bills, factsByMonth });
};
