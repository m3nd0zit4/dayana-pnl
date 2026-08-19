import Stripe from "stripe";

/**
 * Managed Payments requires API version `2025-03-31.basil` or later.
 * https://docs.stripe.com/payments/managed-payments/set-up
 *
 * We deliberately do NOT pass `apiVersion` to the constructor: the installed
 * SDK pins its own (currently well past basil) and the request/response types
 * are generated for exactly that version. Hand-pinning an older string makes
 * the wire format disagree with the types. Instead we assert the SDK's pin is
 * new enough, so a downgrade of the `stripe` package fails loudly here rather
 * than silently at the first `managed_payments` call.
 */
const MIN_API_VERSION = "2025-03-31.basil";

/** `YYYY-MM-DD.codename` — the date prefix sorts lexicographically. */
const versionDate = (version: string): string => version.slice(0, 10);

export const assertManagedPaymentsApiVersion = (version: string): void => {
  if (versionDate(version) < versionDate(MIN_API_VERSION)) {
    throw new Error(
      `[stripe] API version ${version} is older than ${MIN_API_VERSION}, which Managed Payments requires. Upgrade the "stripe" package.`
    );
  }
};

let cached: Stripe | null = null;

/**
 * Lazy singleton. Not created at module load: importing this file must not
 * throw in an environment without Stripe configured (the whole integration is
 * behind STRIPE_CHECKOUT_ENABLED and PayPal/Mercado Pago keep working alone).
 */
export const getStripe = (): Stripe => {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("[stripe] STRIPE_SECRET_KEY is not set");
  }

  const client = new Stripe(key, {
    appInfo: { name: "dayana-pnl", url: "https://dayanabeltran.com" },
  });
  assertManagedPaymentsApiVersion(client.getApiField("version") as string);

  cached = client;
  return client;
};

export const isStripeCheckoutEnabled = (): boolean =>
  process.env.STRIPE_CHECKOUT_ENABLED === "true" &&
  Boolean(process.env.STRIPE_SECRET_KEY?.trim());
