import type Stripe from "stripe";
import { EnrollmentStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { getStripe } from "@/lib/payments/stripe/client";
import { CHECKOUT_REF_KEY } from "@/lib/payments/stripe/checkout";
import {
  findEnrollmentForCheckout,
  fulfillCheckoutPayment,
} from "./checkout-fulfillment";
import { parseCheckoutReference } from "./checkout-reference";
import { abandonCheckoutEnrollment } from "./checkout-placeholder";

export type SyncStripeResult =
  | { outcome: "recorded"; enrollmentId: string }
  | { outcome: "skipped"; reason: string };

/**
 * Stripe reports amounts in the currency's smallest unit, but this CRM stores
 * COP as **whole pesos** (see lib/crm/mercadopago-payments.ts) while Stripe
 * treats COP as a two-decimal currency. USD agrees on both sides (cents).
 */
const toCrmAmountMinor = (amount: number, currency: string): number =>
  currency === "COP" ? Math.round(amount / 100) : Math.round(amount);

const readCheckoutRef = (metadata: Stripe.Metadata | null | undefined) => {
  const raw = metadata?.[CHECKOUT_REF_KEY];
  return raw ? parseCheckoutReference(raw) : null;
};

const alreadyRecorded = async (
  providerPaymentId: string
): Promise<string | null> => {
  const row = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: PaymentProvider.STRIPE,
        providerPaymentId,
      },
    },
    select: { enrollmentId: true },
  });
  return row?.enrollmentId ?? null;
};

/**
 * Records a completed one-off Checkout Session.
 *
 * Idempotent per `provider_providerPaymentId` — safe to call from both the
 * webhook AND `/pago/exito`, so a payment does not depend solely on the
 * webhook arriving (the same belt-and-braces Mercado Pago gets).
 *
 * `mode: subscription` sessions are deliberately **not** fulfilled here: the
 * subscription's own `invoice.paid` does it, including the very first invoice.
 * Recording both would create two `Payment` rows for one charge and hand the
 * member two months of access.
 */
export const syncStripeCheckoutSession = async (
  sessionId: string
): Promise<SyncStripeResult> => {
  const stripe = getStripe();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    console.error("[stripe] session retrieve failed", e);
    return { outcome: "skipped", reason: "session_not_found" };
  }

  if (session.mode === "subscription") {
    // Fulfilment belongs to `invoice.paid`, but the return page still needs an
    // answer: report the enrollment if that invoice already landed, otherwise
    // say we're waiting rather than claiming failure.
    const ref = readCheckoutRef(session.metadata);
    if (!ref) return { outcome: "skipped", reason: "no_reference" };
    const enrollmentId = await findEnrollmentForCheckout(
      ref.contactId,
      ref.planId
    );
    return enrollmentId
      ? { outcome: "recorded", enrollmentId }
      : { outcome: "skipped", reason: "awaiting_invoice_paid" };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) {
    return { outcome: "skipped", reason: "no_payment_intent" };
  }

  const existing = await alreadyRecorded(paymentIntentId);
  if (existing) return { outcome: "recorded", enrollmentId: existing };

  if (session.payment_status !== "paid") {
    // Delayed payment method still pending — checkout.session.async_payment_*
    // will come back with the outcome.
    return { outcome: "skipped", reason: "not_paid" };
  }

  const checkout = readCheckoutRef(session.metadata);
  if (!checkout) {
    return { outcome: "skipped", reason: "no_reference" };
  }

  // Under Managed Payments, Adaptive Pricing may present the customer a local
  // currency. `currency_conversion` carries the total back in the currency the
  // session was created in (USD), which is what the plan and the CRM speak.
  const currency = (
    session.currency_conversion?.source_currency ??
    session.currency ??
    "usd"
  ).toUpperCase();
  const amount =
    session.currency_conversion?.amount_total ?? session.amount_total ?? 0;

  const enrollmentId = await fulfillCheckoutPayment({
    contactId: checkout.contactId,
    productId: checkout.planId,
    provider: PaymentProvider.STRIPE,
    providerPaymentId: paymentIntentId,
    providerOrderId: session.id,
    status: PaymentStatus.APPROVED,
    currency,
    amountMinor: toCrmAmountMinor(amount, currency),
    payerEmail: session.customer_details?.email ?? undefined,
    payerCountryIso:
      session.customer_details?.address?.country?.toUpperCase() ?? undefined,
    rawPayload: session,
    paidAt: new Date(),
    promoCodeRedemption: checkout.promoCode
      ? { code: checkout.promoCode, discountMinor: checkout.discountMinor ?? 0 }
      : undefined,
  });

  return { outcome: "recorded", enrollmentId };
};

/**
 * `checkout.session.async_payment_failed` — release the placeholder enrollment
 * the same way a FAILED payment does in `recordPayment`. No `Payment` row is
 * written: the charge never landed, so there is nothing to reconcile against.
 */
export const failStripeCheckoutSession = async (
  session: Stripe.Checkout.Session
): Promise<SyncStripeResult> => {
  const checkout = readCheckoutRef(session.metadata);
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
  if (!enrollment) return { outcome: "skipped", reason: "no_pending_enrollment" };

  await abandonCheckoutEnrollment(enrollment.id);
  return { outcome: "skipped", reason: "async_payment_failed" };
};

/**
 * Subscription billing: the single recording path for `mode: subscription`,
 * first invoice included.
 *
 * `parent.subscription_details.metadata` is an immutable snapshot of the
 * subscription's metadata taken at invoice finalization, so the checkout
 * reference survives every renewal without an extra API round-trip. Falls back
 * to retrieving the Subscription for invoices predating that snapshot.
 */
export const syncStripeInvoicePaid = async (
  invoice: Stripe.Invoice
): Promise<SyncStripeResult> => {
  const details = invoice.parent?.subscription_details;

  // `parent` is the current shape. The webhook endpoint's API version is a
  // Dashboard setting someone can change, and older versions put the id
  // directly on `invoice.subscription` with no metadata snapshot — fall back
  // rather than silently skipping every renewal.
  const legacySubscription = (
    invoice as unknown as { subscription?: string | { id: string } }
  ).subscription;
  if (!details && !legacySubscription) {
    return { outcome: "skipped", reason: "not_a_subscription" };
  }

  let checkout = details ? readCheckoutRef(details.metadata) : null;
  if (!checkout) {
    const source = details?.subscription ?? legacySubscription;
    const subscriptionId =
      typeof source === "string" ? source : source?.id;
    if (!subscriptionId) {
      return { outcome: "skipped", reason: "no_subscription" };
    }
    const subscription = await getStripe().subscriptions.retrieve(
      subscriptionId
    );
    checkout = readCheckoutRef(subscription.metadata);
  }
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  // The invoice id is stable per billing period and unique per charge, so
  // retries and out-of-order deliveries collapse onto one Payment row.
  const providerPaymentId = invoice.id;
  if (!providerPaymentId) {
    return { outcome: "skipped", reason: "no_invoice_id" };
  }

  const existing = await alreadyRecorded(providerPaymentId);
  if (existing) return { outcome: "recorded", enrollmentId: existing };

  const currency = (invoice.currency ?? "usd").toUpperCase();

  const enrollmentId = await fulfillCheckoutPayment({
    contactId: checkout.contactId,
    productId: checkout.planId,
    provider: PaymentProvider.STRIPE,
    providerPaymentId,
    status: PaymentStatus.APPROVED,
    currency,
    amountMinor: toCrmAmountMinor(invoice.amount_paid ?? 0, currency),
    payerEmail: invoice.customer_email ?? undefined,
    rawPayload: invoice,
    paidAt: new Date(),
    // Renewals must not re-redeem the original promo code: the coupon is
    // `duration: once`, so only the first invoice carries the discount, and it
    // was already booked by that invoice.
  });

  return { outcome: "recorded", enrollmentId };
};

/**
 * `customer.subscription.deleted` — the member cancelled (or dunning gave up).
 * Access is not revoked here: `Enrollment.paidUntil` is prepaid through the end
 * of the period they already paid for, and `getMembershipLockState` closes the
 * portal on its own when that date passes.
 */
export const syncStripeSubscriptionDeleted = async (
  subscription: Stripe.Subscription
): Promise<SyncStripeResult> => {
  const checkout = readCheckoutRef(subscription.metadata);
  if (!checkout) return { outcome: "skipped", reason: "no_reference" };

  const enrollment = await prisma.enrollment.findFirst({
    where: { contactId: checkout.contactId, productId: checkout.planId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!enrollment) return { outcome: "skipped", reason: "enrollment_not_found" };

  return { outcome: "recorded", enrollmentId: enrollment.id };
};
