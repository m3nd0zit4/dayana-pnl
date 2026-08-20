import { PaymentProvider, PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db";
import { fulfillCheckoutPayment } from "./checkout-fulfillment";
import { parseCheckoutReference } from "./checkout-reference";
import { reconcilePendingCheckoutContact } from "./checkout-placeholder";
import { recordPayment } from "./payments";
import { warnOnUnexpectedSubscriptionCharge } from "./subscription-payment-validation";
import { extractPayPalPayer } from "./paypal-payer";
import { fireNotification } from "@/lib/notifications/platform/emit";

/**
 * Suscripciones de PayPal en el CRM.
 *
 * Para el CRM un cobro recurrente no es nada nuevo: es un pago aprobado más, y
 * converge en `fulfillCheckoutPayment` igual que los demás. `Enrollment.paidUntil`
 * es lo que decide el acceso, y `applyMembershipExtension` ya suma un mes
 * exactamente una vez por pago.
 */

export type SyncResult =
  | { outcome: "recorded"; enrollmentId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Los ids de `sale` (suscripciones, API v1) y de `capture` (órdenes, v2) salen
 * de sistemas distintos de PayPal y comparten la restricción
 * `@@unique([provider, providerPaymentId])`. Se namespacean para que no puedan
 * chocar — mismo motivo por el que Lemon Squeezy usa `order:` / `subinv:`.
 */
export const subscriptionPaymentId = (saleId: string): string => `sale:${saleId}`;

type Resource = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * `BILLING.SUBSCRIPTION.ACTIVATED` — la suscripción quedó viva.
 *
 * Guarda el id en la matrícula: es la clave por la que se resuelven TODOS los
 * cobros siguientes, porque `PAYMENT.SALE.COMPLETED` trae `billing_agreement_id`
 * y no garantiza propagar el `custom_id`.
 */
export const syncSubscriptionActivated = async (
  resource: Resource
): Promise<SyncResult> => {
  const subscriptionId = str(resource.id);
  const reference = str(resource.custom_id);
  if (!subscriptionId) return { outcome: "skipped", reason: "no_subscription_id" };
  if (!reference) return { outcome: "skipped", reason: "no_reference" };

  const checkout = parseCheckoutReference(reference);
  if (!checkout) return { outcome: "skipped", reason: "bad_reference" };

  const subscriber = (resource.subscriber ?? {}) as Record<string, unknown>;
  const name = (subscriber.name ?? {}) as Record<string, unknown>;

  // Primera vez: el contacto todavía es el temporal del checkout.
  const contactId = await reconcilePendingCheckoutContact(checkout.contactId, {
    email: str(subscriber.email_address),
    firstName: str(name.given_name),
    lastName: str(name.surname),
  });

  /**
   * La matrícula puede no existir aún: el primer cobro
   * (`PAYMENT.SALE.COMPLETED`) llega junto con este evento y no hay orden
   * garantizado entre los dos. Si todavía no está, el cobro la creará y
   * anotará el id él mismo.
   */
  const enrollment = await prisma.enrollment.findFirst({
    where: { contactId, productId: checkout.planId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (enrollment) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        paypalSubscriptionId: subscriptionId,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
  }

  fireNotification({
    eventType: "SUBSCRIPTION_STARTED",
    title: "Nueva suscripción activa",
    body: "La mensualidad se cobrará sola cada mes.",
    href: "/admin/payments",
    entityType: "Enrollment",
    entityId: enrollment?.id ?? subscriptionId,
    metadata: { subscriptionId, productId: checkout.planId },
    staff: "ALL",
  });

  return enrollment
    ? { outcome: "recorded", enrollmentId: enrollment.id }
    : { outcome: "skipped", reason: "enrollment_pending_first_sale" };
};

/**
 * `PAYMENT.SALE.COMPLETED` — el cobro, tanto el primero como cada renovación.
 *
 * El recurso es de la API v1 y NO tiene la forma de `PAYMENT.CAPTURE.*`:
 * `id`, `amount.total`, `billing_agreement_id`.
 */
export const syncSubscriptionPayment = async (
  resource: Resource
): Promise<SyncResult> => {
  const saleId = str(resource.id);
  const subscriptionId = str(resource.billing_agreement_id);
  if (!saleId) return { outcome: "skipped", reason: "no_sale_id" };
  if (!subscriptionId) {
    // Sin acuerdo de facturación no es un cobro de suscripción.
    return { outcome: "skipped", reason: "not_a_subscription_sale" };
  }

  const providerPaymentId = subscriptionPaymentId(saleId);
  const already = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.PAYPAL,
        providerPaymentId,
      },
    },
    select: { enrollmentId: true },
  });
  if (already) return { outcome: "recorded", enrollmentId: already.enrollmentId };

  const amount = (resource.amount ?? {}) as Record<string, unknown>;
  const total = Number(str(amount.total) ?? "0");
  const currency = (str(amount.currency) ?? "USD").toUpperCase();
  const amountMinor = Math.round(total * 100);

  // Camino normal: la matrícula ya lleva el id de la suscripción.
  const linked = await prisma.enrollment.findUnique({
    where: { paypalSubscriptionId: subscriptionId },
    select: { id: true, productId: true },
  });

  if (linked) {
    await recordPayment({
      enrollmentId: linked.id,
      provider: PaymentProvider.PAYPAL,
      providerPaymentId,
      status: PaymentStatus.APPROVED,
      currency,
      amountMinor,
      rawPayload: resource,
      paidAt: new Date(),
    });
    // Vigilancia, no barrera: el dinero ya está cobrado. Ver
    // lib/crm/subscription-payment-validation.ts.
    await warnOnUnexpectedSubscriptionCharge({
      productId: linked.productId,
      provider: PaymentProvider.PAYPAL,
      amountMinor,
      currency,
      paidAt: new Date(),
      enrollmentId: linked.id,
    });
    return { outcome: "recorded", enrollmentId: linked.id };
  }

  /**
   * Primer cobro que se adelanta a `ACTIVATED`. Se cae a la referencia, que en
   * ese evento sí viaja como `custom`.
   */
  const reference = str(resource.custom);
  const checkout = reference ? parseCheckoutReference(reference) : null;
  if (!checkout) {
    return { outcome: "skipped", reason: "no_enrollment_for_subscription" };
  }

  const contactId = await reconcilePendingCheckoutContact(
    checkout.contactId,
    extractPayPalPayer(resource)
  );

  const enrollmentId = await fulfillCheckoutPayment({
    contactId,
    productId: checkout.planId,
    provider: PaymentProvider.PAYPAL,
    providerPaymentId,
    status: PaymentStatus.APPROVED,
    currency,
    amountMinor,
    rawPayload: resource,
    paidAt: new Date(),
    /**
     * El descuento sólo se aplicó al primer cobro. Las renovaciones NO vuelven
     * a redimir el promo — mismo criterio que
     * `syncLemonSqueezySubscriptionPayment`. Aquí se está en el primer cobro
     * por definición: si hubiera matrícula enlazada, no se llegaría a esta rama.
     */
    promoCodeRedemption: checkout.promoCode
      ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
      : undefined,
  });

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      paypalSubscriptionId: subscriptionId,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
  });

  await warnOnUnexpectedSubscriptionCharge({
    productId: checkout.planId,
    provider: PaymentProvider.PAYPAL,
    amountMinor,
    currency,
    paidAt: new Date(),
    enrollmentId,
  });

  return { outcome: "recorded", enrollmentId };
};

/**
 * Cambios de estado: cancelada, suspendida, vencida.
 *
 * **No revoca el acceso.** `Enrollment.paidUntil` está pagado hasta el final
 * del periodo que la miembro ya compró, y `getMembershipLockState` cierra el
 * portal sola cuando esa fecha pasa. Cortar antes sería quedarse con el dinero
 * de un servicio no prestado.
 */
export const syncSubscriptionStatus = async (
  resource: Resource,
  status: SubscriptionStatus
): Promise<SyncResult> => {
  const subscriptionId = str(resource.id);
  if (!subscriptionId) return { outcome: "skipped", reason: "no_subscription_id" };

  const enrollment = await prisma.enrollment.findUnique({
    where: { paypalSubscriptionId: subscriptionId },
    select: { id: true, paidUntil: true },
  });
  if (!enrollment) return { outcome: "skipped", reason: "enrollment_not_found" };

  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { subscriptionStatus: status },
  });

  if (status === SubscriptionStatus.CANCELLED) {
    fireNotification({
      eventType: "SUBSCRIPTION_CANCELLED",
      title: "Una suscripción se canceló",
      body: enrollment.paidUntil
        ? `El acceso sigue activo hasta el ${enrollment.paidUntil.toLocaleDateString("es-CO")}.`
        : "No se renovará.",
      href: `/admin/enrollments/${enrollment.id}`,
      entityType: "Enrollment",
      entityId: enrollment.id,
      staff: "ALL",
    });
  }

  return { outcome: "recorded", enrollmentId: enrollment.id };
};

/**
 * `BILLING.SUBSCRIPTION.PAYMENT.FAILED` — PayPal no pudo cobrar.
 *
 * No se corta nada: PayPal reintenta por su cuenta y sólo suspende tras el
 * umbral del plan. Avisar a tiempo es lo que permite rescatar la membresía
 * antes de que venza el acceso ya pagado.
 */
export const syncSubscriptionPaymentFailed = async (
  resource: Resource
): Promise<SyncResult> => {
  const subscriptionId = str(resource.id);
  if (!subscriptionId) return { outcome: "skipped", reason: "no_subscription_id" };

  const enrollment = await prisma.enrollment.findUnique({
    where: { paypalSubscriptionId: subscriptionId },
    select: { id: true, contactId: true },
  });
  if (!enrollment) return { outcome: "skipped", reason: "enrollment_not_found" };

  fireNotification({
    eventType: "SUBSCRIPTION_PAYMENT_FAILED",
    title: "No se pudo cobrar una mensualidad",
    body: "PayPal reintentará. Conviene avisar antes de que venza el acceso.",
    href: `/admin/enrollments/${enrollment.id}`,
    entityType: "Enrollment",
    entityId: enrollment.id,
    staff: "ALL",
    contactIds: [enrollment.contactId],
  });

  return { outcome: "recorded", enrollmentId: enrollment.id };
};
