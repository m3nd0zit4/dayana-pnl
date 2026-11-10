// Sin `server-only`, como `lib/crm/stats/*`: así una herramienta del CRM
// (MCP, CLI), que también corre fuera de Next, puede leer los costos el día
// que haga falta sin que el paquete lance al cargarse.

import { prisma } from "@/lib/db";
import { getDateKeyInTz, getStartOfDayInTz } from "@/lib/datetime/zoned-time";
import { OPERATIONAL_TZ, getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { getSiteSetting, resolveUsdToCopRate, setSiteSetting } from "@/lib/crm/site-settings";

import { aiCostUsd, hasAiPrice } from "./ai-prices";
import { collectAuto, type AutoCollection, type AutoStore } from "./auto";
import { buildCostsMonth, type CostBill, type CostsMonth, type MonthFacts, type ServiceStatus } from "./build";
import { COST_SERVICES, type CostServiceId } from "./catalog";
import { fixedPlanBills, pendingFixedPlans } from "./fixed-plans";
import {
  COST_CADENCES,
  COST_CURRENCIES,
  addMonths,
  monthsEndingAt,
  resolveMonth,
  type BillInput,
  type CostCadence,
  type CostCurrency,
} from "./rules";

/**
 * Los costos de la plataforma con la base de datos. Todo sale solo:
 *
 *  - **Proveedores** (`auto/`): Vercel, el dominio, Neon y Mux, preguntados
 *    por su API y guardados seis horas en `site_settings`.
 *  - **Uso propio**: la IA, de `ai_usage_daily` (cada respuesta de Gemini deja
 *    sus tokens, `lib/ai/usage.ts`) al precio de lista. Antes del primer día
 *    con registro solo existen los tokens de las respuestas de WhatsApp
 *    (`whatsapp_ai_runs`): esos días se cuentan con ellas, que es menos de lo
 *    real.
 *  - **Planes fijos** (`fixed-plans.ts`): lo que no informa ninguna API.
 *
 * Y lo que alguien apunte a mano en `platform_costs`, para lo que nada de lo
 * anterior ve. Los correos, SMS y plantillas masivas salen como actividad, no
 * como dinero.
 *
 * Los meses son los de la zona de Dayana. Las columnas TIMESTAMP están sin
 * zona y en UTC: se marcan como UTC y luego se llevan a la zona (ver
 * `lib/crm/dashboard-stats.ts`). Los proveedores facturan por mes UTC: unas
 * horas de diferencia en el borde del mes, que no cambian la cifra.
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

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;

// ── Lo apuntado a mano ──────────────────────────────────────────────────────

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

/** `null` si ya no existe. */
export const updateBill = async (id: string, input: BillInput): Promise<CostBill | null> => {
  const { count } = await prisma.platformCost.updateMany({ where: { id }, data: billData(input) });
  if (count === 0) return null;
  const row = await prisma.platformCost.findUnique({ where: { id } });
  return row ? toBill(row) : null;
};

/** `false` si ya no existía. */
export const deleteBill = async (id: string): Promise<boolean> => {
  const { count } = await prisma.platformCost.deleteMany({ where: { id } });
  return count > 0;
};

// ── Uso propio: la IA y la actividad ────────────────────────────────────────

type AiLogRow = { month: string; model: string; input: bigint; cached: bigint; audio: bigint; output: bigint; calls: bigint };
type AiRunRow = { month: string; model: string | null; input: bigint; output: bigint; cached: bigint; runs: bigint };
type DeliveryRow = { month: string; channel: string; n: bigint };
type TemplateRow = { month: string; n: bigint };

const usageFacts = async (months: string[], timeZone: string): Promise<Record<string, MonthFacts>> => {
  const from = monthStart(months[0], timeZone);
  const to = monthStart(addMonths(months[months.length - 1], 1), timeZone);
  const fromDay = `${months[0]}-01`;
  const toDay = `${addMonths(months[months.length - 1], 1)}-01`;

  const [firstLog] = await prisma.$queryRaw<{ day: Date | null }[]>`SELECT MIN("day") AS day FROM "ai_usage_daily"`;
  // Los días con registro completo no se vuelven a contar con las respuestas
  // de WhatsApp: ya están dentro.
  const runsUntil = firstLog?.day
    ? new Date(Math.min(to.getTime(), getStartOfDayInTz(new Date(`${dateKey(firstLog.day)}T12:00:00.000Z`), timeZone).getTime()))
    : to;

  const [aiLog, aiRuns, deliveries, templates] = await Promise.all([
    prisma.$queryRaw<AiLogRow[]>`
      SELECT
        to_char("day", 'YYYY-MM') AS month,
        "model" AS model,
        SUM("input_tokens")::bigint AS input,
        SUM("cached_tokens")::bigint AS cached,
        SUM("audio_tokens")::bigint AS audio,
        SUM("output_tokens")::bigint AS output,
        SUM("calls")::bigint AS calls
      FROM "ai_usage_daily"
      WHERE "day" >= ${fromDay}::date AND "day" < ${toDay}::date
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<AiRunRow[]>`
      SELECT
        to_char((("queued_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month,
        "model" AS model,
        COALESCE(SUM("input_tokens"), 0)::bigint AS input,
        COALESCE(SUM("output_tokens"), 0)::bigint AS output,
        COALESCE(SUM("cached_tokens"), 0)::bigint AS cached,
        COUNT(*)::bigint AS runs
      FROM "whatsapp_ai_runs"
      WHERE "model" IS NOT NULL
        AND "queued_at" >= ${from} AND "queued_at" < ${runsUntil}
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

  // IA: tokens por modelo, al precio de lista.
  const ai = new Map<string, { usd: number; calls: number; replies: number; unpriced: Set<string> }>();
  const aiOf = (month: string) => {
    let total = ai.get(month);
    if (!total) ai.set(month, (total = { usd: 0, calls: 0, replies: 0, unpriced: new Set() }));
    return total;
  };
  for (const row of aiLog) {
    const total = aiOf(row.month);
    total.usd += aiCostUsd(
      {
        inputTokens: Number(row.input),
        cachedTokens: Number(row.cached),
        audioTokens: Number(row.audio),
        outputTokens: Number(row.output),
      },
      row.model,
    );
    total.calls += Number(row.calls);
    if (!hasAiPrice(row.model)) total.unpriced.add(row.model);
  }
  for (const row of aiRuns) {
    const model = row.model ?? "";
    const total = aiOf(row.month);
    total.usd += aiCostUsd(
      { inputTokens: Number(row.input), cachedTokens: Number(row.cached), audioTokens: 0, outputTokens: Number(row.output) },
      model,
    );
    total.replies += Number(row.runs);
    if (!hasAiPrice(model)) total.unpriced.add(model);
  }
  for (const [month, total] of ai) {
    const facts = factsOf(month);
    facts.measured.gemini = { usdCents: total.usd * 100, kind: "estimate" };
    facts.activity.gemini = [
      total.calls > 0 ? plural(total.calls, "llamada a la IA", "llamadas a la IA") : null,
      // Días anteriores al registro completo: solo se conocen las respuestas de WhatsApp.
      total.replies > 0 ? `${plural(total.replies, "respuesta de WhatsApp", "respuestas de WhatsApp")} de antes del registro completo` : null,
      total.unpriced.size > 0
        ? `${[...total.unpriced].sort().join(", ")} sin tarifa publicada: contado al precio de flash-lite`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
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

// ── Todo junto ──────────────────────────────────────────────────────────────

const siteSettingStore: AutoStore = { get: getSiteSetting, set: setSiteSetting };

/** Lo de los proveedores, dentro de los datos de cada mes y con su estado. Puro. */
export const mergeAuto = (
  factsByMonth: Record<string, MonthFacts>,
  auto: AutoCollection,
): { factsByMonth: Record<string, MonthFacts>; status: Partial<Record<CostServiceId, ServiceStatus>> } => {
  const merged: Record<string, MonthFacts> = {};
  const months = new Set([...Object.keys(factsByMonth), ...Object.keys(auto.months)]);
  for (const month of months) {
    const facts = factsByMonth[month];
    const next: MonthFacts = { measured: { ...facts?.measured }, activity: { ...facts?.activity } };
    for (const [id, value] of Object.entries(auto.months[month] ?? {}) as [CostServiceId, { usdCents: number; kind: "exact" | "estimate"; detail?: string }][]) {
      next.measured[id] = { usdCents: value.usdCents, kind: value.kind };
      if (value.detail) next.activity[id] = value.detail;
    }
    merged[month] = next;
  }

  const status: Partial<Record<CostServiceId, ServiceStatus>> = {};
  for (const [id, s] of Object.entries(auto.status) as [CostServiceId, AutoCollection["status"][CostServiceId]][]) {
    if (!s || s.state === "ok") continue;
    status[id] = {
      state: s.state,
      message:
        s.state === "stale"
          ? `${s.message ?? "No se pudo actualizar."} Se muestra lo último que dijo ${COST_SERVICES[id].name}.`
          : (s.message ?? "No se pudo consultar."),
    };
  }
  return { factsByMonth: merged, status };
};

/** El mes actual en la zona de Dayana, `YYYY-MM`. */
export const currentCostsMonth = async (now: Date = new Date()): Promise<string> => {
  const timeZone = await getOperationalTimezone().catch(() => OPERATIONAL_TZ);
  return getDateKeyInTz(now, timeZone).slice(0, 7);
};

/**
 * Todo lo que pinta la pantalla para un mes (`requested`: lo que venga en la
 * URL). `auto`: para las pruebas, en vez de preguntar a los proveedores.
 */
export const getCostsMonth = async (
  requested: unknown,
  now: Date = new Date(),
  opts: { auto?: (months: string[]) => Promise<AutoCollection> } = {},
): Promise<CostsMonth> => {
  const timeZone = await getOperationalTimezone().catch(() => OPERATIONAL_TZ);
  const currentMonth = getDateKeyInTz(now, timeZone).slice(0, 7);
  const month = resolveMonth(requested, currentMonth);
  const months = monthsEndingAt(month, TREND_MONTHS);

  const [usdToCop, manual, usage, auto] = await Promise.all([
    resolveUsdToCopRate(),
    listBills(),
    usageFacts(months, timeZone),
    opts.auto ? opts.auto(months) : collectAuto(months, { store: siteSettingStore, now }),
  ]);

  const { factsByMonth, status } = mergeAuto(usage, auto);
  for (const id of pendingFixedPlans()) {
    status[id] ??= {
      state: "missing_price",
      message: "Falta el precio del plan. Se escribe una vez en la configuración y cuenta solo cada mes.",
    };
  }

  return buildCostsMonth({
    month,
    currentMonth,
    months,
    usdToCop,
    bills: [...fixedPlanBills(), ...manual],
    factsByMonth,
    status,
  });
};
