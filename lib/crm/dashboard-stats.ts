import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/checkout-placeholder";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";
import { getPendientes } from "@/lib/crm/pendientes";
import { ENROLLMENT_STATUS_PLURAL_LABEL } from "@/lib/crm/enrollment-labels";
import {
  getDateKeyInTz,
  getStartOfDayInTz,
  getStartOfNextDayInTz,
  OPERATIONAL_TZ,
} from "@/lib/crm/operational-timezone";

/** Fila del agregado de pagos por día y moneda. `minor` llega como bigint. */
type PaymentDayRow = { day: string; currency: string; minor: bigint };

export const getDashboardStats = async () => {
  const now = new Date();
  // En paralelo con el resto: la lista de pendientes no depende de ningún
  // agregado de aquí y no debe alargar la carga de la portada.
  const pendientesPromise = getPendientes(now);
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
    usdToCopRate,
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
    // Agregado en SQL, no 14 días de filas traídas para sumarlas en JS. El
    // volumen de pagos sigue al de contactos, así que esto crecía sin tope en
    // cada carga del panel.
    //
    // Se agrupa también por moneda —aunque hoy las dos ramas del cálculo de
    // abajo son idénticas— para que arreglar eso sea un cambio de una línea y
    // no otra migración de consulta.
    prisma.$queryRaw<PaymentDayRow[]>`
      SELECT
        -- paid_at es TIMESTAMP sin zona guardado en UTC. Primero se marca
        -- como UTC y después se lleva a la zona operativa: con una sola
        -- conversión Postgres lo leía como hora de Bogotá y todo pago después
        -- de las ~19:00 UTC (14:00 en Bogotá) caía en el día siguiente.
        to_char((("paid_at" AT TIME ZONE 'UTC') AT TIME ZONE ${OPERATIONAL_TZ})::date, 'YYYY-MM-DD') AS day,
        "currency" AS currency,
        SUM("amount_minor")::bigint AS minor
      FROM "payments"
      WHERE "status" = 'APPROVED' AND "paid_at" >= ${since}
      GROUP BY 1, 2
    `,
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
      },
    }),
    prisma.enrollment.count({
      where: {
        status: EnrollmentStatus.ACTIVE,
        contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } },
        payments: { some: { status: PaymentStatus.APPROVED } },
      },
    }),
    resolveUsdToCopRate(),
  ]);

  const dayMap = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = getDateKeyInTz(d, OPERATIONAL_TZ);
    dayMap.set(key, 0);
  }

  for (const row of paymentsRecent) {
    if (!dayMap.has(row.day)) continue;
    /**
     * Las dos monedas NO comparten escala, y durante meses se sumaron como si
     * la compartieran: 128.609 COP entraban en la gráfica como 1.286 USD, así
     * que cualquier día con un cobro por Mercado Pago aplastaba al resto y la
     * curva de ingresos no medía nada.
     *
     * USD va en centavos (÷100). COP se guarda en pesos completos, sin
     * centavos —ver CLAUDE.md—, así que se convierte con la tasa vigente
     * (CRM → env → 3500) y no se divide por 100.
     */
    const minor = Number(row.minor);
    const usd = row.currency === "COP" ? minor / usdToCopRate : minor / 100;
    dayMap.set(row.day, (dayMap.get(row.day) ?? 0) + usd);
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
    label: ENROLLMENT_STATUS_PLURAL_LABEL[row.status],
    count: row._count._all,
  }));

  const pendientes = await pendientesPromise;

  return {
    pendientes,
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
      // Cuántas sesiones compró y cuántas se han dado. Sale de la propia
      // matrícula: el paquete de terapia que llevaba esta cuenta se retiró
      // porque nadie lo agendaba, pero lo que se vendió sigue siendo un dato.
      sessions:
        e.sessionsTotal != null ? `${e.sessionsUsed}/${e.sessionsTotal}` : null,
    })),
  };
};

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

export const PREVIEW_DASHBOARD: DashboardStats = {
  pendientes: [
    {
      key: "pagos-sin-identificar",
      count: 1,
      label: "pago sin identificar",
      href: "/admin/payments?sin-identificar=1",
      tone: "alert",
    },
    {
      key: "membresias-por-vencer",
      count: 3,
      label: "membresías vencen esta semana",
      href: "/admin/membresias",
      tone: "todo",
    },
  ],
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
