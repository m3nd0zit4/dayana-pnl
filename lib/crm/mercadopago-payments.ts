import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { fulfillCheckoutPayment } from "./checkout-fulfillment";
import { parseCheckoutReference } from "./checkout-reference";
import { recordPayment, resolveEnrollmentFromReference } from "./payments";

export type MercadoPagoApiPayment = {
  id?: number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  payer?: { email?: string };
};

const getAccessToken = () => process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();

/**
 * COP prices are stored as whole pesos everywhere else in the CRM
 * (Product/ProductPrice, portal, admin) — only USD uses cents. Mercado
 * Pago's API always returns `transaction_amount` in the currency's major
 * unit, so COP must NOT be multiplied by 100 like USD is.
 */
const toAmountMinor = (amount: number, currency: string): number =>
  currency === "COP" ? Math.round(amount) : Math.round(amount * 100);

export const fetchMercadoPagoPayment = async (
  paymentId: string
): Promise<MercadoPagoApiPayment | null> => {
  const token = getAccessToken();
  if (!token) return null;

  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return (await res.json()) as MercadoPagoApiPayment;
};

export type SyncMercadoPagoResult =
  | { outcome: "recorded"; enrollmentId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Fetches a Mercado Pago payment by id and records it (Payment row +
 * enrollment) in the CRM. Idempotent per `provider_providerPaymentId` — safe
 * to call from both the webhook AND the checkout-return page, so payment
 * registration does not depend solely on the webhook arriving (misconfigured
 * or delayed notification_url, dashboard webhook not set up, etc.).
 */
export const syncMercadoPagoPayment = async (
  paymentId: string
): Promise<SyncMercadoPagoResult> => {
  // Cheap short-circuit for the checkout-return reconciliation path: if the
  // webhook already recorded this payment (or a refresh calls us twice),
  // skip the round-trip to the Mercado Pago API entirely.
  const existing = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.MERCADO_PAGO,
        providerPaymentId: paymentId,
      },
    },
    select: { enrollmentId: true },
  });
  if (existing) {
    return { outcome: "recorded", enrollmentId: existing.enrollmentId };
  }

  const payment = await fetchMercadoPagoPayment(paymentId);
  if (!payment?.external_reference) {
    return { outcome: "skipped", reason: "no_reference" };
  }

  const mpStatus = payment.status ?? "";
  const approved = mpStatus === "approved";
  const failed =
    mpStatus === "rejected" ||
    mpStatus === "cancelled" ||
    mpStatus === "charged_back";
  const currency = (payment.currency_id ?? "USD").toUpperCase();
  const amountMinor = toAmountMinor(payment.transaction_amount ?? 0, currency);
  const providerPaymentId = String(payment.id ?? paymentId);
  const checkout = parseCheckoutReference(payment.external_reference);

  if (checkout) {
    if (!approved) {
      return { outcome: "skipped", reason: "not_approved" };
    }
    const enrollmentId = await fulfillCheckoutPayment({
      contactId: checkout.contactId,
      productId: checkout.planId,
      provider: PaymentProvider.MERCADO_PAGO,
      providerPaymentId,
      status: PaymentStatus.APPROVED,
      currency,
      amountMinor,
      payerEmail: payment.payer?.email,
      rawPayload: payment,
      paidAt: new Date(),
      promoCodeRedemption: checkout.promoCode
        ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
        : undefined,
    });
    return { outcome: "recorded", enrollmentId };
  }

  const enrollmentId = await resolveEnrollmentFromReference(
    payment.external_reference
  );
  if (!enrollmentId) {
    return { outcome: "skipped", reason: "enrollment_not_found" };
  }

  await recordPayment({
    enrollmentId,
    provider: PaymentProvider.MERCADO_PAGO,
    providerPaymentId,
    status: approved
      ? PaymentStatus.APPROVED
      : failed
        ? PaymentStatus.FAILED
        : PaymentStatus.PENDING,
    currency,
    amountMinor,
    payerEmail: payment.payer?.email,
    rawPayload: payment,
    paidAt: approved ? new Date() : undefined,
  });

  return { outcome: "recorded", enrollmentId };
};
