import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/checkout-placeholder";
import {
  getDateKeyInTz,
  getStartOfDayInTz,
  getStartOfNextDayInTz,
  OPERATIONAL_TZ,
} from "@/lib/crm/operational-timezone";

const STATUS_LABELS: Record<EnrollmentStatus, string> = {
  LEAD: "Leads",
  PENDING_PAYMENT: "Pago pendiente",
  ACTIVE: "Activos",
  COMPLETED: "Completados",
  CANCELLED: "Cancelados",
  REFUNDED: "Reembolsados",
};

export const getDashboardStats = async () => {
  const now = new Date();
  const startOfToday = getStartOfDayInTz(now, OPERATIONAL_TZ);
  const startOfTomorrow = getStartOfNextDayInTz(now, OPERATIONAL_TZ);

  const since = new Date(startOfToday.getTime() - 13 * 24 * 60 * 60 * 1000);

  const [
    leads,
    paymentsToday,
    activeTherapies,
    contacts,
    paymentsRecent,
    enrollmentsByStatus,
    recentContacts,
    activeTherapyRows,
    unlinkedPaidEnrollments,
  ] = await Promise.all([
    prisma.enrollment.count({
      where: {
        status: {
          in: [EnrollmentStatus.LEAD, EnrollmentStatus.PENDING_PAYMENT],
        },
      },
    }),
    prisma.payment.count({
      where: {
        status: PaymentStatus.APPROVED,
        paidAt: { gte: startOfToday, lt: startOfTomorrow },
      },
    }),
    prisma.enrollment.count({
      where: {
        status: EnrollmentStatus.ACTIVE,
        product: { kind: "THERAPY" },
      },
    }),
    prisma.contact.count(),
    prisma.payment.findMany({
      where: {
        status: PaymentStatus.APPROVED,
        paidAt: { gte: since },
      },
      select: { paidAt: true, amountMinor: true, currency: true },
    }),
    prisma.enrollment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneE164: true,
        createdAt: true,
      },
    }),
    prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        product: { kind: "THERAPY" },
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: {
        contact: { select: { firstName: true, lastName: true } },
        product: { select: { title: true } },
        therapyPackage: { select: { usedSessions: true, totalSessions: true } },
      },
    }),
    prisma.enrollment.count({
      where: {
        status: EnrollmentStatus.ACTIVE,
        contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } },
        payments: { some: { status: PaymentStatus.APPROVED } },
      },
    }),
  ]);

  const dayMap = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = getDateKeyInTz(d, OPERATIONAL_TZ);
    dayMap.set(key, 0);
  }

  for (const p of paymentsRecent) {
    if (!p.paidAt) continue;
    const key = getDateKeyInTz(p.paidAt, OPERATIONAL_TZ);
    const usd =
      p.currency === "USD" ? p.amountMinor / 100 : p.amountMinor / 100;
    dayMap.set(key, (dayMap.get(key) ?? 0) + usd);
  }

  const paymentsByDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, amountUsd]) => {
      const [y, m, d] = iso.split("-").map(Number);
      const labelDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      return {
        date: labelDate.toLocaleDateString("es-CO", {
          day: "numeric",
          month: "short",
          timeZone: OPERATIONAL_TZ,
        }),
        amountUsd: Math.round(amountUsd * 100) / 100,
      };
    });

  const pipeline = enrollmentsByStatus.map((row) => ({
    status: row.status,
    label: STATUS_LABELS[row.status],
    count: row._count._all,
  }));

  return {
    stats: {
      leads,
      paymentsToday,
      activeTherapies,
      contacts,
      unlinkedPaidEnrollments,
    },
    paymentsByDay,
    pipeline,
    recentContacts,
    activeTherapyRows: activeTherapyRows.map((e) => ({
      id: e.id,
      contactName: `${e.contact.firstName} ${e.contact.lastName ?? ""}`.trim(),
      productTitle: e.product.title,
      sessions:
        e.therapyPackage != null
          ? `${e.therapyPackage.usedSessions}/${e.therapyPackage.totalSessions}`
          : null,
    })),
  };
};

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

export const PREVIEW_DASHBOARD: DashboardStats = {
  stats: {
    leads: 4,
    paymentsToday: 2,
    activeTherapies: 8,
    contacts: 42,
    unlinkedPaidEnrollments: 0,
  },
  paymentsByDay: [
    { date: "18 may", amountUsd: 0 },
    { date: "19 may", amountUsd: 160 },
    { date: "20 may", amountUsd: 0 },
    { date: "21 may", amountUsd: 320 },
    { date: "22 may", amountUsd: 80 },
    { date: "23 may", amountUsd: 0 },
    { date: "24 may", amountUsd: 240 },
    { date: "25 may", amountUsd: 0 },
    { date: "26 may", amountUsd: 160 },
    { date: "27 may", amountUsd: 0 },
    { date: "28 may", amountUsd: 400 },
    { date: "29 may", amountUsd: 80 },
    { date: "30 may", amountUsd: 0 },
    { date: "31 may", amountUsd: 200 },
  ],
  pipeline: [
    { status: "LEAD", label: "Leads", count: 4 },
    { status: "PENDING_PAYMENT", label: "Pago pendiente", count: 2 },
    { status: "ACTIVE", label: "Activos", count: 12 },
    { status: "COMPLETED", label: "Completados", count: 6 },
  ],
  recentContacts: [
    {
      id: "p1",
      firstName: "María",
      lastName: "González",
      phoneE164: "+34612345678",
      createdAt: new Date(),
    },
  ],
  activeTherapyRows: [
    {
      id: "e1",
      contactName: "Ana Restrepo",
      productTitle: "Terapia 6 sesiones",
      sessions: "2/6",
    },
  ],
};
