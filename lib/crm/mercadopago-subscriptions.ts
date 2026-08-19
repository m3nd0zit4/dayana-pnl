import { PaymentProvider, PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db";
import { fulfillCheckoutPayment } from "./checkout-fulfillment";
import { parseCheckoutReference } from "./checkout-reference";
import { reconcilePendingCheckoutContact } from "./checkout-placeholder";
import { recordPayment } from "./payments";
import {
  getAuthorizedPayment,
  getPreapproval,
} from "@/lib/mercadopago/subscriptions";
import { fireNotification } from "@/lib/notifications/platform/emit";

/**
 * Suscripciones de Mercado Pago en el CRM.
 *
 * Se calca la forma de `paypal-subscriptions.ts`, que ya está probada: el cobro
 * recurrente es un pago aprobado más y converge en `fulfillCheckoutPayment`;
 * `Enrollment.paidUntil` decide el acceso y `applyMembershipExtension` suma un
 * mes exactamente una vez por pago.
 */

export type SyncResult =
  | { outcome: "recorded"; enrollmentId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Namespaceado igual que en PayPal (`sale:`) y Lemon Squeezy (`order:`): los
 * ids de cobro autorizado y los de pago suelto salen de secuencias distintas de
 * MP y comparten `@@unique([provider, providerPaymentId])`.
 */
export const preapprovalPaymentId = (authorizedId: string): string =>
  `preapproval:${authorizedId}`;

const MP_STATUS: Record<string, SubscriptionStatus> = {
  authorized: SubscriptionStatus.ACTIVE,
  paused: SubscriptionStatus.SUSPENDED,
  cancelled: SubscriptionStatus.CANCELLED,
};

/**
 * `subscription_preapproval` — alta y cambios de estado de la suscripción.
 *
 * El estado real se lee de la API de MP, no del cuerpo del webhook: el aviso
 * sólo trae un id, igual que en los pagos sueltos.
 */
export const syncPreapproval = async (
  preapprovalId: string
): Promise<SyncResult> => {
  const sub = await getPreapproval(preapprovalId).catch(() => null);
  if (!sub) return { outcome: "skipped", reason: "preapproval_not_found" };

  const status = MP_STATUS[sub.status ?? ""] ?? SubscriptionStatus.ACTIVE;

  // Si ya está enlazada, esto es un cambio de estado.
  const linked = await prisma.enrollment.findUnique({
    where: { mercadoPagoPreapprovalId: preapprovalId },
    select: { id: true, paidUntil: true },
  });

  if (linked) {
    await prisma.enrollment.update({
      where: { id: linked.id },
      data: { subscriptionStatus: status },
    });

    if (status === SubscriptionStatus.CANCELLED) {
      fireNotification({
        eventType: "SUBSCRIPTION_CANCELLED",
        title: "Una suscripción de Mercado Pago se canceló",
        body: linked.paidUntil
          ? `El acceso sigue activo hasta el ${linked.paidUntil.toLocaleDateString("es-CO")}.`
          : "No se renovará.",
        href: `/admin/enrollments/${linked.id}`,
        entityType: "Enrollment",
        entityId: linked.id,
        staff: "ALL",
      });
    }
    return { outcome: "recorded", enrollmentId: linked.id };
  }

  /**
   * Todavía sin enlazar: se anota sobre la matrícula del checkout si existe. Si
   * no, el primer cobro autorizado la creará y la enlazará él — no hay orden
   * garantizado entre los dos avisos.
   */
  const checkout = sub.external_reference
    ? parseCheckoutReference(sub.external_reference)
    : null;
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  const contactId = await reconcilePendingCheckoutContact(checkout.contactId, {
    email: sub.payer_email,
    countryIso: "CO",
  });

  const enrollment = await prisma.enrollment.findFirst({
    where: { contactId, productId: checkout.planId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!enrollment) {
    return { outcome: "skipped", reason: "enrollment_pending_first_payment" };
  }

  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: {
      mercadoPagoPreapprovalId: preapprovalId,
      subscriptionStatus: status,
      subscriptionProvider: PaymentProvider.MERCADO_PAGO,
    },
  });

  fireNotification({
    eventType: "SUBSCRIPTION_STARTED",
    title: "Nueva suscripción activa (Mercado Pago)",
    body: "La mensualidad se cobrará sola cada mes con la tarjeta autorizada.",
    href: "/admin/payments",
    entityType: "Enrollment",
    entityId: enrollment.id,
    metadata: { preapprovalId, productId: checkout.planId },
    staff: "ALL",
  });

  return { outcome: "recorded", enrollmentId: enrollment.id };
};

/**
 * `subscription_authorized_payment` — cada cobro de la suscripción, el primero
 * incluido.
 */
export const syncAuthorizedPayment = async (
  authorizedId: string
): Promise<SyncResult> => {
  const providerPaymentId = preapprovalPaymentId(authorizedId);

  const already = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.MERCADO_PAGO,
        providerPaymentId,
      },
    },
    select: { enrollmentId: true, status: true },
  });
  if (already && already.status === PaymentStatus.APPROVED) {
    return { outcome: "recorded", enrollmentId: already.enrollmentId };
  }

  const authorized = await getAuthorizedPayment(authorizedId).catch(() => null);
  if (!authorized) return { outcome: "skipped", reason: "authorized_not_found" };

  const preapprovalId = authorized.preapproval_id;
  if (!preapprovalId) return { outcome: "skipped", reason: "no_preapproval_id" };

  // MP marca el cobro como `processed` cuando el dinero entró.
  const cobrado =
    authorized.status === "processed" ||
    authorized.payment?.status === "approved";
  if (!cobrado) {
    return { outcome: "skipped", reason: `not_charged:${authorized.status}` };
  }

  // COP va en pesos enteros, sin centavos (ver CLAUDE.md).
  const amountMinor = Math.round(authorized.transaction_amount ?? 0);
  const currency = (authorized.currency_id ?? "COP").toUpperCase();

  const linked = await prisma.enrollment.findUnique({
    where: { mercadoPagoPreapprovalId: preapprovalId },
    select: { id: true },
  });

  if (linked) {
    await recordPayment({
      enrollmentId: linked.id,
      provider: PaymentProvider.MERCADO_PAGO,
      providerPaymentId,
      status: PaymentStatus.APPROVED,
      currency,
      amountMinor,
      rawPayload: authorized,
      paidAt: new Date(),
    });
    return { outcome: "recorded", enrollmentId: linked.id };
  }

  /**
   * Primer cobro adelantándose al aviso de alta. Se resuelve por la referencia
   * de la propia suscripción, que hay que ir a buscar a la API.
   */
  const sub = await getPreapproval(preapprovalId).catch(() => null);
  const checkout = sub?.external_reference
    ? parseCheckoutReference(sub.external_reference)
    : null;
  if (!checkout) {
    return { outcome: "skipped", reason: "no_enrollment_for_preapproval" };
  }

  const contactId = await reconcilePendingCheckoutContact(checkout.contactId, {
    email: sub?.payer_email,
    countryIso: "CO",
  });

  const enrollmentId = await fulfillCheckoutPayment({
    contactId,
    productId: checkout.planId,
    provider: PaymentProvider.MERCADO_PAGO,
    providerPaymentId,
    status: PaymentStatus.APPROVED,
    currency,
    amountMinor,
    rawPayload: authorized,
    paidAt: new Date(),
    // Sólo el primer cobro redime el promo; las renovaciones no.
    promoCodeRedemption: checkout.promoCode
      ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
      : undefined,
  });

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      mercadoPagoPreapprovalId: preapprovalId,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionProvider: PaymentProvider.MERCADO_PAGO,
    },
  });

  return { outcome: "recorded", enrollmentId };
};
