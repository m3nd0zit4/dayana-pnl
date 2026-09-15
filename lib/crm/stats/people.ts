import "server-only";

import { EnrollmentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/checkout-placeholder";
import { contactFilterSourceSelectOptions } from "@/lib/crm/form-select-options";
import { getMembershipProduct } from "@/lib/lms/membership";
import { PENDIENTES_EXPIRY_WINDOW_DAYS } from "@/lib/crm/pendientes";

import { toBreakdownRows } from "./breakdown";
import type { PeopleStats } from "./dto";
import { withDelta, ratio } from "./kpi";
import { bucketKeys } from "./range";
import { fillSeries, sumByBucket } from "./series";
import { toNumber } from "./currency";
import type { StatsRange } from "./types";
import {
  contactCountryKey,
  contactCountryLabel,
  pipelineStatusLabel,
  resolveSubscriptionProvider,
  subscriptionProviderLabel,
  subscriptionStatusLabel,
  summarizeMembersSnapshot,
} from "./people-content-helpers";

/**
 * «Contactos y membresías» de Estadísticas.
 *
 * Los contactos `+pending:` del checkout sin formulario previo
 * (`lib/crm/checkout-placeholder.ts`) se excluyen de todo: nunca son personas
 * reales hasta que el webhook los completa, y de lo contrario cada intento de
 * pago abandonado infla «contactos nuevos».
 */

/** Fila diaria (fecha local "YYYY-MM-DD") de un `COUNT(*)` agrupado. */
type DayCountRow = { day: string; count: bigint | number | string };

const notPlaceholder = { phoneE164: { not: { startsWith: PLACEHOLDER_PHONE_PREFIX } } };

export async function getPeopleStats(
  range: StatsRange,
  now: Date = new Date(),
): Promise<PeopleStats> {
  const membershipProduct = await getMembershipProduct();
  // Sin producto de membresía configurado, ningún enrollment puede
  // pertenecerle: el mismo comodín que usa `getPendientes`.
  const membershipProductId = membershipProduct?.id ?? "__sin-membresia__";

  const [
    newContactsCount,
    newContactsPrevCount,
    newContactsSeriesRows,
    contactsBySourceRows,
    contactsByCountryRows,
    consentingContactsCount,
    membershipSnapshotRows,
    newPaidMembersCount,
    newPaidMembersPrevCount,
    renewalsCount,
    renewalsPrevCount,
    activeSubscriptionRows,
    pipelineRows,
  ] = await Promise.all([
    prisma.contact.count({
      where: { createdAt: { gte: range.from, lt: range.to }, ...notPlaceholder },
    }),
    prisma.contact.count({
      where: { createdAt: { gte: range.prevFrom, lt: range.prevTo }, ...notPlaceholder },
    }),
    prisma.$queryRaw<DayCountRow[]>`
      SELECT
        to_char((("created_at" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timeZone})::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::bigint AS count
      FROM "contacts"
      WHERE "created_at" >= ${range.from} AND "created_at" < ${range.to}
        AND "phone_e164" NOT LIKE ${`${PLACEHOLDER_PHONE_PREFIX}%`}
      GROUP BY 1
    `,
    prisma.contact.groupBy({
      by: ["source"],
      where: { createdAt: { gte: range.from, lt: range.to }, ...notPlaceholder },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ["countryIso"],
      where: { createdAt: { gte: range.from, lt: range.to }, ...notPlaceholder },
      _count: { _all: true },
    }),
    prisma.contact.count({
      where: {
        createdAt: { gte: range.from, lt: range.to },
        consentMarketingAt: { not: null },
        ...notPlaceholder,
      },
    }),
    // Foto fija a `now`: sólo lo que hace falta para clasificar vigencia
    // (`summarizeMembersSnapshot`, en `people-content-helpers.ts`, puro y
    // probado aparte).
    prisma.enrollment.findMany({
      where: {
        productId: membershipProductId,
        status: EnrollmentStatus.ACTIVE,
        lifetimeAccess: false,
      },
      select: { paidUntil: true },
    }),
    prisma.enrollment.count({
      where: {
        productId: membershipProductId,
        parentEnrollmentId: null,
        paidAt: { gte: range.from, lt: range.to },
      },
    }),
    prisma.enrollment.count({
      where: {
        productId: membershipProductId,
        parentEnrollmentId: null,
        paidAt: { gte: range.prevFrom, lt: range.prevTo },
      },
    }),
    // Renovación = pago de la membresía sobre una matrícula que YA tenía
    // padre (la creó `applyMembershipExtension`/el webhook de recurrencia al
    // cobrar de nuevo), no una matrícula nueva. `newPaidMembers` es lo
    // contrario: `parentEnrollmentId: null`.
    prisma.enrollment.count({
      where: {
        productId: membershipProductId,
        parentEnrollmentId: { not: null },
        paidAt: { gte: range.from, lt: range.to },
      },
    }),
    prisma.enrollment.count({
      where: {
        productId: membershipProductId,
        parentEnrollmentId: { not: null },
        paidAt: { gte: range.prevFrom, lt: range.prevTo },
      },
    }),
    // Snapshot ACTUAL (no acotado al rango): «¿cómo está la cartera de
    // suscripciones hoy?», igual que `lib/crm/subscriptions.ts`.
    prisma.enrollment.findMany({
      where: { subscriptionStatus: { not: null } },
      select: {
        subscriptionStatus: true,
        paypalSubscriptionId: true,
        mercadoPagoPreapprovalId: true,
        subscriptionProvider: true,
      },
    }),
    prisma.enrollment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const newContacts = withDelta(newContactsCount, newContactsPrevCount);

  const newContactsSeries = fillSeries(
    bucketKeys(range),
    sumByBucket(
      newContactsSeriesRows.map((r) => ({ dateKey: r.day, value: toNumber(r.count) })),
      range.granularity,
    ),
  );

  const sourceLabels = new Map(
    contactFilterSourceSelectOptions().map((o) => [o.value, o.label]),
  );
  const contactsBySource = toBreakdownRows(
    contactsBySourceRows.map((r) => ({
      key: r.source,
      value: r._count._all,
      label: sourceLabels.get(r.source) ?? r.source,
    })),
  );

  const contactsByCountry = toBreakdownRows(
    contactsByCountryRows.map((r) => ({
      key: contactCountryKey(r.countryIso),
      value: r._count._all,
      label: contactCountryLabel(r.countryIso),
    })),
    { limit: 8 },
  );

  const marketingConsentRate = ratio(consentingContactsCount, newContactsCount);

  const members = summarizeMembersSnapshot(membershipSnapshotRows, now, PENDIENTES_EXPIRY_WINDOW_DAYS);

  const newPaidMembers = withDelta(newPaidMembersCount, newPaidMembersPrevCount);
  const renewals = withDelta(renewalsCount, renewalsPrevCount);

  const byStatus = new Map<string, number>();
  const byProvider = new Map<string, number>();
  for (const row of activeSubscriptionRows) {
    const status = row.subscriptionStatus as string;
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const provider = resolveSubscriptionProvider(row);
    const providerKey = provider ?? "__sin-proveedor__";
    byProvider.set(providerKey, (byProvider.get(providerKey) ?? 0) + 1);
  }

  const subscriptionsByStatus = toBreakdownRows(
    [...byStatus.entries()].map(([key, value]) => ({
      key,
      value,
      label: subscriptionStatusLabel(key),
    })),
  );
  const subscriptionsByProvider = toBreakdownRows(
    [...byProvider.entries()].map(([key, value]) => ({
      key,
      value,
      label: key === "__sin-proveedor__" ? "Sin proveedor" : subscriptionProviderLabel(key),
    })),
  );

  const pipeline = toBreakdownRows(
    pipelineRows.map((r) => ({
      key: r.status,
      value: r._count._all,
      label: pipelineStatusLabel(r.status),
    })),
  );

  return {
    newContacts,
    newContactsSeries,
    contactsBySource,
    contactsByCountry,
    marketingConsentRate,
    members,
    newPaidMembers,
    renewals,
    subscriptionsByStatus,
    subscriptionsByProvider,
    pipeline,
  };
}
