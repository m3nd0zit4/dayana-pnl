import { EnrollmentStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { CHECKOUT_REF_KEY } from "@/lib/payments/lemonsqueezy/checkout";
import { isLemonSqueezySubscriptionPlan } from "@/lib/payments/lemonsqueezy/catalog";
import { fulfillCheckoutPayment } from "./checkout-fulfillment";
import { parseCheckoutReference } from "./checkout-reference";
import { recordPayment } from "./payments";
import {
  abandonCheckoutEnrollment,
  reconcilePendingCheckoutContact,
} from "./checkout-placeholder";

export type SyncLemonSqueezyResult =
  | { outcome: "recorded"; enrollmentId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Payload de webhook de Lemon Squeezy (JSON:API). Sólo se tipa lo que se usa.
 */
export type LemonSqueezyWebhookPayload = {
  meta?: {
    event_name?: string;
    custom_data?: Record<string, string> | null;
  };
  data?: {
    id?: string;
    type?: string;
    attributes?: Record<string, unknown>;
  };
};

/**
 * Los ids de order y de subscription-invoice son enteros de secuencias
 * distintas: sin prefijo colisionan en `@@unique([provider, providerPaymentId])`
 * y una renovación se convertiría en un no-op contra una orden ajena.
 */
export const lemonSqueezyPaymentId = (
  kind: "order" | "subinv",
  id: string | number
): string => `${kind}:${id}`;

const readCheckoutRef = (payload: LemonSqueezyWebhookPayload) => {
  const raw = payload.meta?.custom_data?.[CHECKOUT_REF_KEY];
  return raw ? parseCheckoutReference(raw) : null;
};

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/** LS entrega un solo `user_name`; el CRM guarda nombre y apellido aparte. */
const splitName = (
  full?: string
): { firstName?: string; lastName?: string } => {
  const parts = full?.trim().split(/\s+/) ?? [];
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

const alreadyRecorded = async (
  providerPaymentId: string
): Promise<string | null> => {
  const row = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.LEMON_SQUEEZY,
        providerPaymentId,
      },
    },
    select: { enrollmentId: true },
  });
  return row?.enrollmentId ?? null;
};

/**
 * `order_created` — compra de pago único.
 *
 * Una compra de suscripción dispara `order_created` **y**
 * `subscription_payment_success`. Registrar los dos crearía dos filas de
 * `Payment` para un solo cobro y regalaría un mes de membresía, así que aquí
 * se sale en cuanto el plan es de suscripción: ese dinero lo registra
 * `syncLemonSqueezySubscriptionPayment`.
 */
export const syncLemonSqueezyOrder = async (
  payload: LemonSqueezyWebhookPayload
): Promise<SyncLemonSqueezyResult> => {
  const checkout = readCheckoutRef(payload);
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  if (await isLemonSqueezySubscriptionPlan(checkout.planId)) {
    return { outcome: "skipped", reason: "handled_by_subscription_payment" };
  }

  const orderId = payload.data?.id;
  if (!orderId) return { outcome: "skipped", reason: "no_order_id" };

  const attrs = payload.data?.attributes ?? {};
  if (str(attrs.status) !== "paid") {
    return { outcome: "skipped", reason: "not_paid" };
  }

  const providerPaymentId = lemonSqueezyPaymentId("order", orderId);
  const existing = await alreadyRecorded(providerPaymentId);
  if (existing) return { outcome: "recorded", enrollmentId: existing };

  // El contacto puede ser el temporal creado al abrir el checkout: se completa
  // ANTES de matricular, porque si ya existe una ficha real con ese email hay
  // que matricular en esa y no crear una segunda.
  const contactId = await reconcilePendingCheckoutContact(checkout.contactId, {
    email: str(attrs.user_email),
    ...splitName(str(attrs.user_name)),
  });

  // `total_usd` en centavos: LS cobra en la moneda del cliente pero reporta
  // siempre el equivalente en USD, que es lo que habla el CRM fuera de Colombia.
  const enrollmentId = await fulfillCheckoutPayment({
    contactId,
    productId: checkout.planId,
    provider: PaymentProvider.LEMON_SQUEEZY,
    providerPaymentId,
    status: PaymentStatus.APPROVED,
    currency: "USD",
    amountMinor: num(attrs.total_usd),
    payerEmail: str(attrs.user_email),
    rawPayload: payload,
    paidAt: new Date(),
    promoCodeRedemption: checkout.promoCode
      ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
      : undefined,
  });

  return { outcome: "recorded", enrollmentId };
};

/**
 * `subscription_payment_success` — única vía de registro de la mensualidad,
 * primera factura incluida (`billing_reason: initial`). LS confirmó en marzo de
 * 2023 que este evento cubre tanto el cobro inicial como las renovaciones.
 */
export const syncLemonSqueezySubscriptionPayment = async (
  payload: LemonSqueezyWebhookPayload
): Promise<SyncLemonSqueezyResult> => {
  const checkout = readCheckoutRef(payload);
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  const invoiceId = payload.data?.id;
  if (!invoiceId) return { outcome: "skipped", reason: "no_invoice_id" };

  const attrs = payload.data?.attributes ?? {};
  if (str(attrs.status) !== "paid") {
    return { outcome: "skipped", reason: "not_paid" };
  }

  const providerPaymentId = lemonSqueezyPaymentId("subinv", invoiceId);
  const existing = await alreadyRecorded(providerPaymentId);
  if (existing) return { outcome: "recorded", enrollmentId: existing };

  // Igual que en `order_created`: en la primera factura el contacto todavía es
  // el temporal. En las renovaciones ya es real y esto es un no-op.
  const contactId = await reconcilePendingCheckoutContact(checkout.contactId, {
    email: str(attrs.user_email),
    ...splitName(str(attrs.user_name)),
  });

  const enrollmentId = await fulfillCheckoutPayment({
    contactId,
    productId: checkout.planId,
    provider: PaymentProvider.LEMON_SQUEEZY,
    providerPaymentId,
    status: PaymentStatus.APPROVED,
    currency: "USD",
    amountMinor: num(attrs.total_usd),
    payerEmail: str(attrs.user_email),
    rawPayload: payload,
    paidAt: new Date(),
    // Las renovaciones no vuelven a redimir el promo: el descuento sólo se
    // aplicó al primer cobro y ya quedó registrado allí.
    promoCodeRedemption:
      str(attrs.billing_reason) === "initial" && checkout.promoCode
        ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
        : undefined,
  });

  return { outcome: "recorded", enrollmentId };
};

/**
 * `order_refunded` — marca el pago como REFUNDED. No se toca la matrícula
 * aquí: `recordPayment` ya decide qué hacer con ella según el estado.
 */
export const syncLemonSqueezyRefund = async (
  payload: LemonSqueezyWebhookPayload
): Promise<SyncLemonSqueezyResult> => {
  const orderId = payload.data?.id;
  if (!orderId) return { outcome: "skipped", reason: "no_order_id" };

  const providerPaymentId = lemonSqueezyPaymentId("order", orderId);
  const payment = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.LEMON_SQUEEZY,
        providerPaymentId,
      },
    },
    select: { enrollmentId: true, currency: true, amountMinor: true },
  });
  if (!payment) return { outcome: "skipped", reason: "payment_not_found" };

  await recordPayment({
    enrollmentId: payment.enrollmentId,
    provider: PaymentProvider.LEMON_SQUEEZY,
    providerPaymentId,
    status: PaymentStatus.REFUNDED,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
    rawPayload: payload,
  });

  return { outcome: "recorded", enrollmentId: payment.enrollmentId };
};

/**
 * `subscription_expired` / `subscription_cancelled`.
 *
 * No revoca el acceso: `Enrollment.paidUntil` está pagado hasta el final del
 * periodo que el miembro ya compró y `getMembershipLockState` cierra el portal
 * solo cuando esa fecha pasa. Aquí sólo se deja constancia.
 */
export const syncLemonSqueezySubscriptionEnded = async (
  payload: LemonSqueezyWebhookPayload
): Promise<SyncLemonSqueezyResult> => {
  const checkout = readCheckoutRef(payload);
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  const enrollment = await prisma.enrollment.findFirst({
    where: { contactId: checkout.contactId, productId: checkout.planId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!enrollment) return { outcome: "skipped", reason: "enrollment_not_found" };

  return { outcome: "recorded", enrollmentId: enrollment.id };
};

/**
 * Checkout abandonado tras un fallo de cobro: libera la matrícula placeholder,
 * igual que hace `recordPayment` con un pago FAILED.
 */
export const failLemonSqueezyCheckout = async (
  payload: LemonSqueezyWebhookPayload
): Promise<SyncLemonSqueezyResult> => {
  const checkout = readCheckoutRef(payload);
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      contactId: checkout.contactId,
      productId: checkout.planId,
      status: EnrollmentStatus.PENDING_PAYMENT,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!enrollment) {
    return { outcome: "skipped", reason: "no_pending_enrollment" };
  }

  await abandonCheckoutEnrollment(enrollment.id);
  return { outcome: "skipped", reason: "payment_failed" };
};
