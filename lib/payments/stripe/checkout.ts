import type Stripe from "stripe";
import { siteBaseUrl } from "@/lib/mercadopago/amount";
import { encodeCheckoutReference } from "@/lib/crm/checkout-reference";
import { getStripe } from "./client";

export type StripeCheckoutMode = "payment" | "subscription";

export type CreateStripeCheckoutSessionInput = {
  contactId: string;
  planId: string;
  /** Stripe Price id resolved from ProductPrice.stripePriceId. */
  priceId: string;
  mode: StripeCheckoutMode;
  managedPayments: boolean;
  /** Discount in USD cents, already validated. Creates a one-shot coupon. */
  promo?: { code: string; discountMinor: number };
  customerEmail?: string;
  /** ISO-639-1 for the hosted page; defaults to Spanish. */
  locale?: Stripe.Checkout.SessionCreateParams.Locale;
};

export type CreatedStripeCheckoutSession = {
  id: string;
  url: string;
  checkoutReference: string;
};

/**
 * Metadata key carrying `chk:<contactId>:<planId>[:<promo>:<discount>]`.
 * The webhook reads it back through `parseCheckoutReference`, exactly like
 * PayPal's `custom_id` and Mercado Pago's `external_reference`.
 */
export const CHECKOUT_REF_KEY = "checkoutRef";

export const createStripeCheckoutSession = async (
  input: CreateStripeCheckoutSessionInput
): Promise<CreatedStripeCheckoutSession> => {
  const stripe = getStripe();
  const base = siteBaseUrl();

  const checkoutReference = encodeCheckoutReference(
    input.contactId,
    input.planId,
    input.promo
  );
  const metadata = { [CHECKOUT_REF_KEY]: checkoutReference };

  // A one-shot coupon rather than a re-validated promo code: the discount is
  // already baked into the reference, and re-checking the code at webhook time
  // could reject a payment that was correctly charged minutes earlier (expiry,
  // redemption cap). Same reasoning as lib/crm/checkout-reference.ts.
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  if (input.promo && input.promo.discountMinor > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: input.promo.discountMinor,
      currency: "usd",
      duration: "once",
      name: `Promo ${input.promo.code}`,
      max_redemptions: 1,
      metadata,
    });
    discounts = [{ coupon: coupon.id }];
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: input.mode,
    line_items: [{ price: input.priceId, quantity: 1 }],
    managed_payments: { enabled: input.managedPayments },
    client_reference_id: input.contactId,
    metadata,
    locale: input.locale ?? "es",
    success_url: `${base}/pago/exito?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/pago/cancelado`,
    discounts,
  };

  if (input.customerEmail) {
    params.customer_email = input.customerEmail;
  }

  // The reference is mirrored onto whatever object the webhook will actually
  // see: `checkout.session.completed` carries session.metadata, but a
  // subscription renewal arrives as `invoice.paid`, which only reaches the
  // Subscription's metadata.
  if (input.mode === "subscription") {
    params.subscription_data = { metadata };
  } else {
    params.payment_intent_data = { metadata };
  }

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error("[stripe] checkout session created without a url");
  }

  return { id: session.id, url: session.url, checkoutReference };
};
