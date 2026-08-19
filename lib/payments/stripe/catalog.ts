import { prisma } from "@/lib/db";
import type { StripeCheckoutMode } from "./checkout";

export type ResolvedStripePrice = {
  priceId: string;
  managedPayments: boolean;
  productTitle: string;
};

/**
 * Resolves the Stripe Price for a plan + mode.
 *
 * Returns null when the product was never pushed to Stripe, or has no
 * recurring price for `mode: subscription`. The caller turns that into a 400
 * rather than falling back to an inline `price_data`, which would bypass the
 * product's tax code and make the session ineligible for Managed Payments.
 */
export const resolveStripePrice = async (
  planId: string,
  mode: StripeCheckoutMode
): Promise<ResolvedStripePrice | null> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: {
      title: true,
      isActive: true,
      isCourseContent: true,
      stripeManagedPayments: true,
      stripePriceId: true,
      stripeRecurringPriceId: true,
    },
  });

  if (!product || !product.isActive || product.isCourseContent) return null;

  const priceId =
    mode === "subscription"
      ? product.stripeRecurringPriceId
      : product.stripePriceId;
  if (!priceId) return null;

  return {
    priceId,
    managedPayments: product.stripeManagedPayments,
    productTitle: product.title,
  };
};
