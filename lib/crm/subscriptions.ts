import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { grossUpInt, grossUpUsd, mercadoPagoFee, paypalFee } from "../pricing/fees";

/**
 * Los planes de suscripción que existen, y quién se está cobrando por ellos.
 *
 * Existe porque el CRM no tenía dónde mirar ninguna de las dos cosas. Miembros
 * (Membresías · Personas) contesta «¿tiene el acceso al día?», que es otra pregunta:
 * quien pagó un mes suelto y quien está en un cobro recurrente se leen igual
 * si sólo se mira `paidUntil`.
 *
 * Y sobre todo: **un plan no se puede borrar**. Ni PayPal ni Mercado Pago lo
 * permiten, sólo desactivarlo. Eso convierte «¿qué planes tengo creados?» en
 * una pregunta que hay que poder contestar ANTES de crear otro, y hasta ahora
 * la respuesta vivía en una columna que ninguna pantalla pintaba.
 *
 * ## Por qué NO se llama a los proveedores al cargar la pantalla
 *
 * El bruto que se muestra se calcula aquí con el mismo `lib/pricing/fees.ts`
 * que usan los scripts de alta: es lo que el plan **debería** estar cobrando.
 * Saber lo que cobra de verdad es un viaje a las dos APIs, y de eso ya se
 * encarga `verifyProductPriceSync` — a mano con «Verificar ahora», y solo cada
 * mañana con el cron.
 *
 * Meterlo en la carga sería pedirle permiso a PayPal y a Mercado Pago para
 * pintar una lista: lenta, y caída cuando el proveedor lo esté. Peor: el token
 * de Mercado Pago es productivo incluso en desarrollo, así que abrir la
 * pantalla golpearía la cuenta real. Comprobar es una acción, no un efecto de
 * mirar.
 */

export type SubscriptionPlanRow = {
  productId: string;
  productTitle: string;
  isActive: boolean;
  provider: PaymentProvider;
  /** El id con el que se encuentra el plan en el panel del proveedor. */
  planId: string;
  currency: "USD" | "COP";
  /** El precio público: lo que se anuncia. */
  netMinor: number | null;
  /** Lo que el plan cobra, con la comisión ya dentro. */
  grossMinor: number | null;
  /** Lo que se lleva la pasarela, en unidades menores. */
  feeMinor: number | null;
  syncStatus: "SYNCED" | "DRIFTED";
  syncNote: string | null;
  syncCheckedAt: string | null;
  /** Suscripciones vivas cobrándose por este riel. */
  activeSubscribers: number;
};

const latestPrice = (
  prices: { currency: string; amountMinor: number }[],
  currency: "USD" | "COP"
) => prices.find((p) => p.currency === currency) ?? null;

export const listSubscriptionPlans = async (): Promise<SubscriptionPlanRow[]> => {
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { paypalPlanId: { not: null } },
        { mercadoPagoPreapprovalPlanId: { not: null } },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: { prices: { orderBy: { validFrom: "desc" } } },
  });

  /*
    El recuento se hace por el ID de la suscripción, NO por
    `subscriptionProvider`.

    Esa columna la escribía Mercado Pago y no la escribía PayPal, así que
    agrupar por ella daba cero suscripciones de PayPal aunque las hubiera. Ya
    está arreglado en `lib/crm/paypal-subscriptions.ts`, pero las filas
    anteriores siguen con el campo vacío y no se va a hacer un backfill para
    una pantalla de consulta: el id es el hecho, la columna es la etiqueta.

    Dos consultas y no una porque `groupBy` no sabe agrupar por «cuál de estos
    dos campos está lleno». Son dos recuentos, no dos recorridos de tabla.
  */
  const productIds = products.map((p) => p.id);
  const live = { subscriptionStatus: "ACTIVE" as const, productId: { in: productIds } };
  const [paypalCounts, mpCounts] = await Promise.all([
    prisma.enrollment.groupBy({
      by: ["productId"],
      where: { ...live, paypalSubscriptionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.enrollment.groupBy({
      by: ["productId"],
      where: { ...live, mercadoPagoPreapprovalId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countOf = (productId: string, provider: PaymentProvider) =>
    (provider === PaymentProvider.PAYPAL ? paypalCounts : mpCounts).find(
      (c) => c.productId === productId
    )?._count._all ?? 0;

  const rows: SubscriptionPlanRow[] = [];

  for (const product of products) {
    const base = {
      productId: product.id,
      productTitle: product.title,
      isActive: product.isActive,
      syncStatus: product.priceSyncStatus,
      syncNote: product.priceSyncNote,
      syncCheckedAt: product.priceSyncCheckedAt?.toISOString() ?? null,
    };

    if (product.paypalPlanId) {
      const net = latestPrice(product.prices, "USD");
      // `grossUpUsd` trabaja en unidades mayores; la fila las guarda menores.
      const breakdown =
        net != null ? grossUpUsd(net.amountMinor / 100, paypalFee()) : null;
      rows.push({
        ...base,
        provider: PaymentProvider.PAYPAL,
        planId: product.paypalPlanId,
        currency: "USD",
        netMinor: net?.amountMinor ?? null,
        grossMinor: breakdown ? Math.round(breakdown.gross * 100) : null,
        feeMinor: breakdown ? Math.round(breakdown.fee * 100) : null,
        activeSubscribers: countOf(product.id, PaymentProvider.PAYPAL),
      });
    }

    if (product.mercadoPagoPreapprovalPlanId) {
      // El COP va en pesos enteros: no hay centavos que convertir.
      const net = latestPrice(product.prices, "COP");
      const breakdown =
        net != null ? grossUpInt(net.amountMinor, mercadoPagoFee()) : null;
      rows.push({
        ...base,
        provider: PaymentProvider.MERCADO_PAGO,
        planId: product.mercadoPagoPreapprovalPlanId,
        currency: "COP",
        netMinor: net?.amountMinor ?? null,
        grossMinor: breakdown ? Math.round(breakdown.gross) : null,
        feeMinor: breakdown ? Math.round(breakdown.fee) : null,
        activeSubscribers: countOf(product.id, PaymentProvider.MERCADO_PAGO),
      });
    }
  }

  return rows;
};

export type SubscriberRow = {
  enrollmentId: string;
  contactId: string;
  name: string;
  email: string | null;
  phoneE164: string;
  productId: string;
  productTitle: string;
  status: string;
  subscriptionStatus: string | null;
  provider: PaymentProvider | null;
  /** El id de la suscripción en el proveedor. */
  subscriptionRef: string | null;
  paidUntil: string | null;
  lastPaymentAt: string | null;
  paymentsCount: number;
  amountMinor: number | null;
  currency: string | null;
};

/**
 * Quién está suscrita.
 *
 * Ordenado por `paidUntil` ASCENDENTE, al revés que Miembros. No es un capricho:
 * Miembros ordena por vigencia descendente —quién tiene más margen— y aquí la
 * pregunta es la contraria. **A quién se le acaba antes** es a quien hay que
 * mirar hoy; quien tiene ocho meses por delante no necesita salir arriba.
 *
 * Las que no tienen fecha van al final: sin `paidUntil` no hay nada que venza.
 */
export const listSubscribers = async (): Promise<SubscriberRow[]> => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      // Una matrícula cuenta como suscripción si lleva marca de riel
      // recurrente. No se filtra por producto: si mañana hay un segundo plan,
      // sale solo.
      OR: [
        { paypalSubscriptionId: { not: null } },
        { mercadoPagoPreapprovalId: { not: null } },
        { subscriptionStatus: { not: null } },
      ],
    },
    orderBy: [
      { paidUntil: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneE164: true,
        },
      },
      product: { select: { id: true, title: true } },
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: { paidAt: "desc" },
        take: 1,
        select: { paidAt: true, createdAt: true },
      },
      _count: {
        select: { payments: { where: { status: PaymentStatus.APPROVED } } },
      },
    },
  });

  return enrollments.map((en) => ({
    enrollmentId: en.id,
    contactId: en.contact.id,
    name: [en.contact.firstName, en.contact.lastName].filter(Boolean).join(" "),
    email: en.contact.email,
    phoneE164: en.contact.phoneE164,
    productId: en.product.id,
    productTitle: en.product.title,
    status: en.status,
    subscriptionStatus: en.subscriptionStatus,
    // Mismo criterio que el recuento: manda el id, que es el hecho. La columna
    // `subscriptionProvider` sólo se usa si no hay ninguno de los dos.
    provider: en.paypalSubscriptionId
      ? PaymentProvider.PAYPAL
      : en.mercadoPagoPreapprovalId
        ? PaymentProvider.MERCADO_PAGO
        : en.subscriptionProvider,
    subscriptionRef: en.paypalSubscriptionId ?? en.mercadoPagoPreapprovalId,
    paidUntil: en.paidUntil?.toISOString() ?? null,
    lastPaymentAt:
      (en.payments[0]?.paidAt ?? en.payments[0]?.createdAt)?.toISOString() ??
      null,
    paymentsCount: en._count.payments,
    amountMinor: en.amountMinor,
    currency: en.currency,
  }));
};

export type SubscriptionsOverview = {
  plans: SubscriptionPlanRow[];
  subscribers: SubscriberRow[];
};

export const getSubscriptionsOverview = async (): Promise<SubscriptionsOverview> => {
  const [plans, subscribers] = await Promise.all([
    listSubscriptionPlans(),
    listSubscribers(),
  ]);
  return { plans, subscribers };
};
