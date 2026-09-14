import "server-only";

import { PaymentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { sumTotals } from "@/lib/crm/payments-list";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";

import { toBreakdownRows, toFunnelSteps } from "./breakdown";
import { toNumber, type CurrencyTotals } from "./currency";
import type { BreakdownRow, FunnelStep, SalesStats } from "./dto";
import { ratio, withDelta } from "./kpi";
import { bucketKeys } from "./range";
import {
  NO_FAILURE_CODE_LABEL,
  NULL_KEY,
  PAYMENT_LINK_STEP_LABELS,
  PAYMENT_PROVIDER_LABEL,
  averageTickets,
  buildSeriesByCurrency,
  buildUsdEquivalentSeries,
  countryLabel,
  mergeBreakdownInputs,
  mergeMoneyKpis,
  totalsByCurrency,
} from "./sales-helpers";
import type { StatsRange } from "./types";

/**
 * «Ventas e ingresos». Periodo actual = [from, to); anterior = [prevFrom, prevTo).
 *
 * Convenciones:
 * - Lo cobrado se ubica por `paidAt` (cuándo entró el dinero); los intentos
 *   (tasa de fallo) por `createdAt`, porque un pago fallido no tiene `paidAt`.
 * - Importes en unidades menores y siempre por moneda; nunca se suman COP y USD.
 * - Las columnas son TIMESTAMP sin zona guardadas en UTC: para agrupar por día
 *   local se marcan primero como UTC y luego se llevan a `range.timeZone`
 *   (ver `lib/crm/dashboard-stats.ts`).
 */

type NetRow = {
  currency: string;
  fee_current_count: bigint;
  net_current: bigint | null;
  fee_previous_count: bigint;
  net_previous: bigint | null;
  without_fee: bigint;
};

type AttemptRow = {
  approved_current: bigint;
  failed_current: bigint;
  approved_previous: bigint;
  failed_previous: bigint;
};

type DayRow = { day: string; currency: string; minor: bigint | null };

type ProductRow = { product_id: string; title: string; currency: string; minor: bigint | null };

type LinkRow = { created: bigint; opened: bigint; started: bigint; paid: bigint };

/** `sumTotals` → totales y conteos de aprobados, solo monedas con aprobados. */
const approvedTotals = (totals: ReturnType<typeof sumTotals>) => {
  const revenue: CurrencyTotals = {};
  const counts: CurrencyTotals = {};
  for (const t of totals) {
    if (t.approvedCount === 0) continue;
    revenue[t.currency] = t.approvedMinor;
    counts[t.currency] = t.approvedCount;
  }
  return { revenue, counts };
};

const sumValues = (totals: CurrencyTotals): number =>
  Object.values(totals).reduce((acc, n) => acc + n, 0);

export async function getSalesStats(range: StatsRange): Promise<SalesStats> {
  const { from, to, prevFrom, prevTo, timeZone } = range;
  const current = { gte: from, lt: to };
  const previous = { gte: prevFrom, lt: prevTo };

  const [
    paidCurrent,
    paidPrevious,
    netRows,
    attemptRows,
    failureCodeGroups,
    dayRows,
    productRows,
    providerCountryGroups,
    promoCurrent,
    promoPrevious,
    promoDiscounts,
    linkRows,
    usdToCopRate,
  ] = await Promise.all([
    // Ingresos, cantidad de aprobados y «reembolsados del periodo»: aprobados y
    // reembolsados por `paidAt`. Un reembolsado conserva su `paidAt`, así que
    // el pago cobrado en el periodo que hoy figura REFUNDED sale de aquí.
    prisma.payment.groupBy({
      by: ["currency", "status"],
      where: { status: { in: [PaymentStatus.APPROVED, PaymentStatus.REFUNDED] }, paidAt: current },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["currency", "status"],
      where: { status: PaymentStatus.APPROVED, paidAt: previous },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    // Neto: solo pagos aprobados con comisión conocida (`fee_minor`), para no
    // presentar como neto un bruto sin descontar. Si falta `net_minor` se
    // deriva como importe − comisión. Aparte, cuántos aprobados del periodo no
    // traen comisión (manuales, sobre todo) y por tanto quedan fuera del neto.
    prisma.$queryRaw<NetRow[]>`
      SELECT
        "currency" AS currency,
        COUNT(*) FILTER (WHERE "fee_minor" IS NOT NULL AND "paid_at" >= ${from}) AS fee_current_count,
        SUM(COALESCE("net_minor", "amount_minor" - "fee_minor"))
          FILTER (WHERE "fee_minor" IS NOT NULL AND "paid_at" >= ${from})::bigint AS net_current,
        COUNT(*) FILTER (WHERE "fee_minor" IS NOT NULL AND "paid_at" < ${prevTo}) AS fee_previous_count,
        SUM(COALESCE("net_minor", "amount_minor" - "fee_minor"))
          FILTER (WHERE "fee_minor" IS NOT NULL AND "paid_at" < ${prevTo})::bigint AS net_previous,
        COUNT(*) FILTER (WHERE "fee_minor" IS NULL AND "paid_at" >= ${from}) AS without_fee
      FROM "payments"
      WHERE "status" = 'APPROVED' AND "paid_at" >= ${prevFrom} AND "paid_at" < ${to}
      GROUP BY 1
    `,
    // Tasa de fallo = FAILED / (APPROVED + FAILED) por `createdAt`. PENDING no
    // cuenta (aún no hay resultado) ni REFUNDED (fue un cobro que salió bien).
    prisma.$queryRaw<AttemptRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "status" = 'APPROVED' AND "created_at" >= ${from}) AS approved_current,
        COUNT(*) FILTER (WHERE "status" = 'FAILED' AND "created_at" >= ${from}) AS failed_current,
        COUNT(*) FILTER (WHERE "status" = 'APPROVED' AND "created_at" < ${prevTo}) AS approved_previous,
        COUNT(*) FILTER (WHERE "status" = 'FAILED' AND "created_at" < ${prevTo}) AS failed_previous
      FROM "payments"
      WHERE "status" IN ('APPROVED', 'FAILED') AND "created_at" >= ${prevFrom} AND "created_at" < ${to}
    `,
    // Motivos de rechazo más frecuentes del periodo (código crudo del proveedor).
    prisma.payment.groupBy({
      by: ["failureCode"],
      where: { status: PaymentStatus.FAILED, createdAt: current },
      _count: { _all: true },
    }),
    // Serie: suma diaria local por moneda; semana/mes se reagrupan en JS.
    prisma.$queryRaw<DayRow[]>`
      SELECT
        to_char((("paid_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
        "currency" AS currency,
        SUM("amount_minor")::bigint AS minor
      FROM "payments"
      WHERE "status" = 'APPROVED' AND "paid_at" >= ${from} AND "paid_at" < ${to}
      GROUP BY 1, 2
    `,
    // Por producto: el de la matrícula a la que pertenece el pago.
    prisma.$queryRaw<ProductRow[]>`
      SELECT e."product_id" AS product_id, pr."title" AS title, p."currency" AS currency,
        SUM(p."amount_minor")::bigint AS minor
      FROM "payments" p
      JOIN "enrollments" e ON e."id" = p."enrollment_id"
      JOIN "products" pr ON pr."id" = e."product_id"
      WHERE p."status" = 'APPROVED' AND p."paid_at" >= ${from} AND p."paid_at" < ${to}
      GROUP BY 1, 2, 3
    `,
    // Por proveedor y por país del pagador, desde un solo agrupado.
    prisma.payment.groupBy({
      by: ["provider", "payerCountryIso", "currency"],
      where: { status: PaymentStatus.APPROVED, paidAt: current },
      _sum: { amountMinor: true },
    }),
    // Códigos promocionales: canjes por fecha de canje y descuento por moneda.
    prisma.promoCodeRedemption.count({ where: { createdAt: current } }),
    prisma.promoCodeRedemption.count({ where: { createdAt: previous } }),
    prisma.promoCodeRedemption.groupBy({
      by: ["currency"],
      where: { createdAt: current },
      _sum: { discountMinor: true },
    }),
    // Enlaces de pago creados en el periodo y hasta dónde llegó cada uno. Los
    // pasos son acumulativos (cada uno exige los anteriores) para que el embudo
    // nunca suba. Ojo: `paid_at` solo se sella en enlaces con contacto, así
    // que «Pagados» se queda corto con enlaces abiertos reutilizables.
    prisma.$queryRaw<LinkRow[]>`
      SELECT
        COUNT(*) AS created,
        COUNT(*) FILTER (WHERE "opened_at" IS NOT NULL) AS opened,
        COUNT(*) FILTER (WHERE "opened_at" IS NOT NULL AND "checkout_started_at" IS NOT NULL) AS started,
        COUNT(*) FILTER (
          WHERE "opened_at" IS NOT NULL AND "checkout_started_at" IS NOT NULL AND "paid_at" IS NOT NULL
        ) AS paid
      FROM "payment_links"
      WHERE "created_at" >= ${from} AND "created_at" < ${to}
    `,
    resolveUsdToCopRate(),
  ]);

  // Ingresos, cantidad y ticket promedio.
  const cur = approvedTotals(sumTotals(paidCurrent));
  const prev = approvedTotals(sumTotals(paidPrevious));
  const revenue = mergeMoneyKpis(cur.revenue, prev.revenue);
  const refundedFromPeriod = sumTotals(paidCurrent).reduce((acc, t) => acc + t.refundedCount, 0);

  // Neto: una moneda entra en cada periodo solo si tuvo pagos con comisión.
  const netCurrent: CurrencyTotals = {};
  const netPrevious: CurrencyTotals = {};
  let paymentsWithoutFee = 0;
  for (const row of netRows) {
    if (toNumber(row.fee_current_count) > 0) netCurrent[row.currency] = toNumber(row.net_current);
    if (toNumber(row.fee_previous_count) > 0) netPrevious[row.currency] = toNumber(row.net_previous);
    paymentsWithoutFee += toNumber(row.without_fee);
  }

  const attempts = attemptRows[0];
  const approvedCur = toNumber(attempts?.approved_current);
  const failedCur = toNumber(attempts?.failed_current);
  const approvedPrev = toNumber(attempts?.approved_previous);
  const failedPrev = toNumber(attempts?.failed_previous);

  // Series.
  const keys = bucketKeys(range);
  const seriesByCurrency = buildSeriesByCurrency(
    dayRows.map((r) => ({ dateKey: r.day, currency: r.currency, value: toNumber(r.minor) })),
    keys,
    range.granularity,
  );

  const promoTotals = totalsByCurrency(
    promoDiscounts.map((g) => ({ currency: g.currency, value: g._sum.discountMinor ?? 0 })),
  );

  return {
    revenue,
    net: mergeMoneyKpis(netCurrent, netPrevious),
    paymentsWithoutFee,
    approvedCount: withDelta(sumValues(cur.counts), sumValues(prev.counts)),
    averageTicket: averageTickets(
      revenue.map((r) => r.currency),
      cur.revenue,
      cur.counts,
    ),
    failureRate: {
      value: ratio(failedCur, approvedCur + failedCur),
      previous: ratio(failedPrev, approvedPrev + failedPrev),
    },
    topFailureCodes: failureCodeBreakdown(failureCodeGroups),
    refundedFromPeriod,
    usdEquivalentSeries: buildUsdEquivalentSeries(seriesByCurrency, keys, usdToCopRate),
    seriesByCurrency,
    byProduct: toBreakdownRows(
      productRows.map((r) => ({
        key: `${r.product_id}:${r.currency}`,
        label: r.title,
        value: toNumber(r.minor),
        currency: r.currency,
      })),
    ),
    ...providerAndCountryBreakdowns(providerCountryGroups),
    promo: {
      redemptions: withDelta(promoCurrent, promoPrevious),
      discountByCurrency: Object.keys(promoTotals)
        .sort()
        .map((currency) => ({ currency, minor: promoTotals[currency] })),
    },
    paymentLinks: paymentLinkSteps(linkRows[0]),
    usdToCopRate,
  };
}

/** Top 5 de códigos de rechazo; sin código se agrupa como «sin código». */
const failureCodeBreakdown = (
  groups: { failureCode: string | null; _count: { _all: number } }[],
): BreakdownRow[] =>
  toBreakdownRows(
    groups.map((g) => ({
      key: g.failureCode ?? NULL_KEY,
      label: g.failureCode ?? NO_FAILURE_CODE_LABEL,
      value: g._count._all,
    })),
    { limit: 5 },
  );

/** Importe aprobado por proveedor y por país del pagador, cada uno por moneda. */
const providerAndCountryBreakdowns = (
  groups: {
    provider: string;
    payerCountryIso: string | null;
    currency: string;
    _sum: { amountMinor: number | null };
  }[],
): { byProvider: BreakdownRow[]; byCountry: BreakdownRow[] } => ({
  byProvider: toBreakdownRows(
    mergeBreakdownInputs(
      groups.map((g) => ({
        key: `${g.provider}:${g.currency}`,
        label: PAYMENT_PROVIDER_LABEL[g.provider] ?? g.provider,
        value: g._sum.amountMinor ?? 0,
        currency: g.currency,
      })),
    ),
  ),
  byCountry: toBreakdownRows(
    mergeBreakdownInputs(
      groups.map((g) => ({
        key: `${g.payerCountryIso?.trim().toUpperCase() || NULL_KEY}:${g.currency}`,
        label: countryLabel(g.payerCountryIso),
        value: g._sum.amountMinor ?? 0,
        currency: g.currency,
      })),
    ),
  ),
});

const paymentLinkSteps = (row: LinkRow | undefined): FunnelStep[] =>
  toFunnelSteps([
    { key: "created", label: PAYMENT_LINK_STEP_LABELS.created, count: toNumber(row?.created) },
    { key: "opened", label: PAYMENT_LINK_STEP_LABELS.opened, count: toNumber(row?.opened) },
    {
      key: "checkoutStarted",
      label: PAYMENT_LINK_STEP_LABELS.checkoutStarted,
      count: toNumber(row?.started),
    },
    { key: "paid", label: PAYMENT_LINK_STEP_LABELS.paid, count: toNumber(row?.paid) },
  ]);
