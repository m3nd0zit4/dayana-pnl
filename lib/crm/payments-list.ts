import { PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  isPlaceholderContactPhone,
  PLACEHOLDER_PHONE_PREFIX,
} from "./checkout-placeholder";

/**
 * La lista de Pagos del panel: consulta, filtros y totales.
 *
 * Antes vivía entera dentro de la ruta de API, que devolvía las últimas 50
 * filas y nada más. Con eso no se podía trabajar: no había forma de buscar un
 * cobro concreto, de mirar un mes cerrado, ni de saber cuánto se llevaba
 * ingresado sin sumar a mano. Y la exportación necesita exactamente la misma
 * consulta, así que o se extraía aquí o se escribía dos veces y se separaban a
 * la primera.
 */

export type PaymentListRow = {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  currency: string;
  amountMinor: number;
  feeMinor: number | null;
  netMinor: number | null;
  payerEmail: string | null;
  payerCountryIso: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  providerPaymentId: string;
  providerOrderId: string | null;
  paidAt: string | null;
  createdAt: string;
  /**
   * El teléfono `+pending:` es el único rastro de que la conciliación no
   * encontró a nadie. Se traduce a bandera aquí para no filtrar el placeholder
   * al cliente ni obligarle a conocer el prefijo.
   */
  unidentified: boolean;
  enrollment: {
    id: string;
    contact: {
      id: string;
      firstName: string;
      lastName: string | null;
      displayName: string | null;
      email: string | null;
    };
    product: { id: string; title: string };
  };
};

/**
 * Totales del período, **siempre por moneda y nunca sumados entre ellas**:
 * sumar pesos con dólares da un número que no significa nada.
 */
export type PaymentCurrencyTotal = {
  currency: string;
  approvedMinor: number;
  approvedCount: number;
  pendingCount: number;
  failedCount: number;
  refundedCount: number;
};

export type PaymentListFilters = {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  provider?: string;
  productId?: string;
  unidentified?: boolean;
};

const SELECT = {
  id: true,
  provider: true,
  status: true,
  currency: true,
  amountMinor: true,
  feeMinor: true,
  netMinor: true,
  payerEmail: true,
  payerCountryIso: true,
  failureCode: true,
  failureMessage: true,
  providerPaymentId: true,
  providerOrderId: true,
  paidAt: true,
  createdAt: true,
  enrollment: {
    select: {
      id: true,
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
          phoneE164: true,
        },
      },
      product: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

const isStatus = (v: string): v is PaymentStatus =>
  Object.prototype.hasOwnProperty.call(PaymentStatus, v);

const isProvider = (v: string): v is PaymentProvider =>
  Object.prototype.hasOwnProperty.call(PaymentProvider, v);

/**
 * El `to` del filtro es un día, no un instante.
 *
 * Quien escribe «hasta el 30» espera que entren los cobros del 30. Tomando la
 * fecha tal cual, el rango se cierra a las 00:00 y ese día entero se queda
 * fuera: un mes que no cuadra por los cobros del último día.
 */
const endOfDay = (iso: string): Date => {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
};

export function paymentListWhere(
  f: PaymentListFilters,
): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {};

  if (f.status && f.status !== "all" && isStatus(f.status)) {
    where.status = f.status;
  }
  if (f.provider && f.provider !== "all" && isProvider(f.provider)) {
    where.provider = f.provider;
  }

  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: new Date(f.from) } : {}),
      ...(f.to ? { lte: endOfDay(f.to) } : {}),
    };
  }

  const enrollment: Prisma.EnrollmentWhereInput = {};
  if (f.productId && f.productId !== "all") {
    enrollment.productId = f.productId;
  }
  if (f.unidentified) {
    enrollment.contact = {
      phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX },
    };
  }
  if (Object.keys(enrollment).length > 0) {
    where.enrollment = enrollment;
  }

  const q = f.q?.trim();
  if (q) {
    /*
      Se busca por lo que Dayana tiene delante cuando pregunta por un cobro: el
      nombre, el correo, o el identificador que le da el proveedor cuando
      reclama. El id interno también, porque es lo que llevan los enlaces del
      propio panel.
    */
    where.OR = [
      { providerPaymentId: { contains: q, mode: "insensitive" } },
      { providerOrderId: { contains: q, mode: "insensitive" } },
      { payerEmail: { contains: q, mode: "insensitive" } },
      { id: q },
      {
        enrollment: {
          contact: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  return where;
}

type RawRow = Prisma.PaymentGetPayload<{ select: typeof SELECT }>;

const toRow = (p: RawRow): PaymentListRow => ({
  id: p.id,
  provider: p.provider,
  status: p.status,
  currency: p.currency,
  amountMinor: p.amountMinor,
  feeMinor: p.feeMinor,
  netMinor: p.netMinor,
  payerEmail: p.payerEmail,
  payerCountryIso: p.payerCountryIso,
  failureCode: p.failureCode,
  failureMessage: p.failureMessage,
  providerPaymentId: p.providerPaymentId,
  providerOrderId: p.providerOrderId,
  paidAt: p.paidAt ? p.paidAt.toISOString() : null,
  createdAt: p.createdAt.toISOString(),
  unidentified: isPlaceholderContactPhone(p.enrollment.contact.phoneE164),
  enrollment: {
    id: p.enrollment.id,
    contact: {
      id: p.enrollment.contact.id,
      firstName: p.enrollment.contact.firstName,
      lastName: p.enrollment.contact.lastName,
      displayName: p.enrollment.contact.displayName,
      email: p.enrollment.contact.email,
    },
    product: p.enrollment.product,
  },
});

export type PaymentListPage = {
  payments: PaymentListRow[];
  nextCursor: string | null;
};

/**
 * Una página de la lista.
 *
 * Pagina por cursor y no por `skip`: la lista va por fecha descendente y entra
 * dinero mientras se navega, así que con desplazamiento numérico un cobro
 * nuevo empuja las filas y la página siguiente repite la última.
 */
export async function listPayments(
  filters: PaymentListFilters,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<PaymentListPage> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const rows = await prisma.payment.findMany({
    where: paymentListWhere(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: SELECT,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    payments: page.map(toRow),
    nextCursor: hasMore && last ? last.id : null,
  };
}

/** Todas las filas que casan con el filtro, para la exportación. */
export async function listAllPaymentsForExport(
  filters: PaymentListFilters,
): Promise<PaymentListRow[]> {
  const rows = await prisma.payment.findMany({
    where: paymentListWhere(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SELECT,
  });
  return rows.map(toRow);
}

/**
 * Los totales se calculan sobre **todo** lo que casa con el filtro, no sobre la
 * página cargada. Si no, el número de arriba cambiaría al pulsar «cargar más»,
 * que es justo lo que hace que nadie se fíe de él.
 */
export async function getPaymentTotals(
  filters: PaymentListFilters,
): Promise<PaymentCurrencyTotal[]> {
  const grouped = await prisma.payment.groupBy({
    by: ["currency", "status"],
    where: paymentListWhere(filters),
    _sum: { amountMinor: true },
    _count: { _all: true },
  });

  const byCurrency = new Map<string, PaymentCurrencyTotal>();
  for (const g of grouped) {
    const t = byCurrency.get(g.currency) ?? {
      currency: g.currency,
      approvedMinor: 0,
      approvedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      refundedCount: 0,
    };
    const n = g._count._all;
    if (g.status === "APPROVED") {
      t.approvedMinor += g._sum.amountMinor ?? 0;
      t.approvedCount += n;
    } else if (g.status === "PENDING") {
      t.pendingCount += n;
    } else if (g.status === "REFUNDED") {
      t.refundedCount += n;
    } else {
      t.failedCount += n;
    }
    byCurrency.set(g.currency, t);
  }

  return [...byCurrency.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}
