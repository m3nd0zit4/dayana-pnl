import { PaymentProvider, PaymentStatus, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  isPlaceholderContactPhone,
  PLACEHOLDER_PHONE_PREFIX,
} from "./checkout-placeholder";
import {
  OPERATIONAL_TZ,
  getStartOfDayInTz,
  getStartOfNextDayInTz,
} from "./operational-timezone";
import {
  clampTake,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  splitPage,
} from "./pagination";
import { MAX_SEARCH_TOKENS, foldForSearch } from "./search-normalize";

/**
 * Lectura de pagos para `/admin/payments`. La escritura (`recordPayment`,
 * webhooks) vive en `lib/crm/payments.ts` y no se toca aquí — son dos
 * responsabilidades distintas y una de las dos es dinero real.
 */

export type PaymentListFilters = {
  /** Se recorta; una cadena vacía no es un filtro. */
  q?: string;
  /** `YYYY-MM-DD`, día calendario en la zona operativa (Bogotá). */
  from?: string;
  /** `YYYY-MM-DD`, inclusive del día completo — ver `buildPaymentsWhere`. */
  to?: string;
  status?: PaymentStatus | "all";
  provider?: PaymentProvider | "all";
  productId?: string | "all";
  /** Mismo criterio que hoy: contacto con teléfono `+pending:…`. */
  unidentified?: boolean;
  cursor?: string | null;
  limit?: number;
};

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
 * Total de un período para UNA moneda. Nunca se suma entre monedas — sumar
 * pesos y dólares da un número que no significa nada — y `approvedMinor`
 * cuenta solo lo aprobado: un "total" que incluye rechazos en silencio es
 * mentir sobre el ingreso real.
 */
export type PaymentCurrencyTotal = {
  currency: string;
  approvedMinor: number;
  approvedCount: number;
  pendingCount: number;
  failedCount: number;
  refundedCount: number;
};

export type PaymentListResult = {
  payments: PaymentListRow[];
  nextCursor: string | null;
  totals: PaymentCurrencyTotal[];
};

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD` → un instante dentro de ese día, para dárselo a los ayudantes
 * de zona, que trabajan sobre `Date` y no sobre una clave de día. Se ancla al
 * mediodía UTC a propósito: cualquier hora cercana a medianoche caería en el
 * día anterior o el siguiente según el desfase de la zona.
 */
const dayKeyToInstant = (dayKey: string): Date | null => {
  if (!DAY_KEY_RE.test(dayKey)) return null;
  const at = new Date(`${dayKey}T12:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at;
};

export const buildPaymentsWhere = (
  filters: PaymentListFilters
): Prisma.PaymentWhereInput => {
  const and: Prisma.PaymentWhereInput[] = [];

  const q = (filters.q ?? "").trim();
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
    for (const token of tokens.length > 0 ? tokens : [q]) {
      and.push({
        OR: [
          // `searchText` ya pliega nombre, apellido, display y email del
          // contacto (ver Contact.searchText en el schema) — un solo `LIKE`
          // servido por su GIN de trigramas en vez de recorrer cada campo.
          {
            enrollment: {
              contact: { searchText: { contains: foldForSearch(token) } },
            },
          },
          { payerEmail: { contains: token, mode: "insensitive" } },
          { providerPaymentId: { contains: token, mode: "insensitive" } },
          { providerOrderId: { contains: token, mode: "insensitive" } },
        ],
      });
    }
  }

  /**
   * `to` es inclusivo del día completo EN LA ZONA OPERATIVA (Bogotá), no en
   * UTC: `lte: new Date(to)` trunca a medianoche UTC, que en Bogotá (UTC-5)
   * cae a las 7pm del día anterior y recorta las últimas horas del día que el
   * operador sí quiso incluir. Se resuelve como un rango semiabierto
   * `[inicio de "from", inicio del día SIGUIENTE a "to")`.
   */
  const fromDay = filters.from ? dayKeyToInstant(filters.from) : null;
  const toDay = filters.to ? dayKeyToInstant(filters.to) : null;
  const fromAt = fromDay ? getStartOfDayInTz(fromDay, OPERATIONAL_TZ) : null;
  const toAt = toDay ? getStartOfNextDayInTz(toDay, OPERATIONAL_TZ) : null;
  if (fromAt || toAt) {
    const range = {
      ...(fromAt ? { gte: fromAt } : {}),
      ...(toAt ? { lt: toAt } : {}),
    };
    and.push({
      OR: [
        // Un pago cobrado se ubica por `paidAt`.
        { paidAt: range },
        // Un intento sin cobrar (pendiente o rechazado) no tiene `paidAt`:
        // cae a `createdAt`, que es cuando SÍ pasó algo. Sin este `fallback`
        // un pago rechazado en el rango pedido desaparecería del todo en vez
        // de aparecer como lo que es — un intento que no llegó a cobrarse.
        { paidAt: null, createdAt: range },
      ],
    });
  }

  if (filters.status && filters.status !== "all") {
    and.push({ status: filters.status });
  }
  if (filters.provider && filters.provider !== "all") {
    and.push({ provider: filters.provider });
  }
  if (filters.productId && filters.productId !== "all") {
    and.push({ enrollment: { productId: filters.productId } });
  }
  if (filters.unidentified) {
    and.push({
      enrollment: {
        contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } },
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
};

const rowInclude = {
  enrollment: {
    include: {
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
} as const;

type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof rowInclude;
}>;

const toRow = (p: PaymentWithRelations): PaymentListRow => ({
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
  // El teléfono `+pending:` es el único rastro de que la conciliación no
  // encontró a nadie (ver `lib/crm/payments.ts`).
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

export const sumTotals = (
  rows: { currency: string; status: PaymentStatus; _sum: { amountMinor: number | null }; _count: { _all: number } }[]
): PaymentCurrencyTotal[] => {
  const byCurrency = new Map<string, PaymentCurrencyTotal>();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      approvedMinor: 0,
      approvedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      refundedCount: 0,
    };
    if (row.status === PaymentStatus.APPROVED) {
      entry.approvedMinor += row._sum.amountMinor ?? 0;
      entry.approvedCount += row._count._all;
    } else if (row.status === PaymentStatus.PENDING) {
      entry.pendingCount += row._count._all;
    } else if (row.status === PaymentStatus.FAILED) {
      entry.failedCount += row._count._all;
    } else if (row.status === PaymentStatus.REFUNDED) {
      entry.refundedCount += row._count._all;
    }
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );
};

/**
 * Página keyset de pagos + totales del período, ordenada por
 * `(createdAt desc, id desc)` — mismo esquema de cursor que `contacts.ts`
 * (`lib/crm/pagination.ts`).
 *
 * Los totales se calculan sobre TODO el conjunto filtrado, no sobre la
 * página: un `groupBy` aparte comparte exactamente el mismo `where` que la
 * lista, así que no pueden divergir.
 */
export const listPayments = async (
  filters: PaymentListFilters
): Promise<PaymentListResult> => {
  const where = buildPaymentsWhere(filters);
  const take = clampTake(filters.limit);
  const cursor = decodeCursor(filters.cursor);

  const [rows, totalsRaw] = await Promise.all([
    prisma.payment.findMany({
      where: cursor ? { AND: [where, keysetWhere("createdAt", cursor)] } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      include: rowInclude,
    }),
    prisma.payment.groupBy({
      by: ["currency", "status"],
      where,
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
  ]);

  const { items, nextCursor } = splitPage(rows, take, (row) =>
    encodeCursor(row.createdAt, row.id)
  );

  return {
    payments: items.map(toRow),
    nextCursor,
    totals: sumTotals(totalsRaw),
  };
};

/** Tope duro de filas exportadas — el CSV no es una consulta libre. */
export const PAYMENTS_EXPORT_LIMIT = 5000;

export type PaymentExportResult = {
  rows: PaymentListRow[];
  /** `true` si había más filas de las que caben en `PAYMENTS_EXPORT_LIMIT`. */
  truncated: boolean;
};

/**
 * Todas las filas que casan con los filtros (hasta el tope), para el CSV.
 * A propósito NO toma `cursor`/`limit`: el export es sobre los filtros
 * aplicados, no sobre la página que el operador tiene abierta.
 */
export const listPaymentsForExport = async (
  filters: Omit<PaymentListFilters, "cursor" | "limit">
): Promise<PaymentExportResult> => {
  const where = buildPaymentsWhere(filters);
  const rows = await prisma.payment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAYMENTS_EXPORT_LIMIT + 1,
    include: rowInclude,
  });
  const truncated = rows.length > PAYMENTS_EXPORT_LIMIT;
  return {
    rows: (truncated ? rows.slice(0, PAYMENTS_EXPORT_LIMIT) : rows).map(toRow),
    truncated,
  };
};
