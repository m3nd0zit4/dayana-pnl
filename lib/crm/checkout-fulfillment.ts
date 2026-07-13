import { EnrollmentStatus, ProductKind } from "@prisma/client";
import { prisma } from "../db";
import { createEnrollment } from "./enrollments";
import { recordPayment, type RecordPaymentInput } from "./payments";
import { redeemPromoCode } from "./promo-codes";

export type FulfillCheckoutPaymentInput = Omit<
  RecordPaymentInput,
  "enrollmentId"
> & {
  contactId: string;
  productId: string;
  /** Discount already baked into `amountMinor` — recorded here for bookkeeping only. */
  promoCodeRedemption?: { code: string; discountMinor: number };
};

const redeemIfPresent = async (
  enrollmentId: string,
  currency: string,
  promo?: { code: string; discountMinor: number }
): Promise<void> => {
  if (!promo) return;
  try {
    const row = await prisma.promoCode.findUnique({
      where: { code: promo.code.trim().toUpperCase() },
      select: { id: true },
    });
    if (!row) return;
    await redeemPromoCode({
      promoCodeId: row.id,
      enrollmentId,
      currency,
      discountMinor: promo.discountMinor,
    });
  } catch (e) {
    // Bookkeeping only — never let redemption tracking break a real payment.
    console.error("[checkout-fulfillment] promo redemption failed", e);
  }
};

/**
 * Creates an ACTIVE enrollment and records payment when web checkout completes.
 * Idempotent per provider payment id.
 */
export const fulfillCheckoutPayment = async (
  input: FulfillCheckoutPaymentInput
): Promise<string> => {
  const existing = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
      },
    },
    select: { enrollmentId: true },
  });
  if (existing) return existing.enrollmentId;

  const { contactId: _c, productId: _p, promoCodeRedemption, ...paymentInput } = input;

  // Course = monthly membership: renewals land on the contact's existing
  // enrollment instead of piling up duplicate ACTIVE enrollments.
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { kind: true },
  });
  if (product?.kind === ProductKind.COURSE) {
    const existingEnrollmentId = await findEnrollmentForCheckout(
      input.contactId,
      input.productId
    );
    if (existingEnrollmentId) {
      await recordPayment({
        ...paymentInput,
        enrollmentId: existingEnrollmentId,
      });
      await redeemIfPresent(existingEnrollmentId, input.currency, promoCodeRedemption);
      return existingEnrollmentId;
    }
  }

  const enrollment = await createEnrollment({
    contactId: input.contactId,
    productId: input.productId,
    status: EnrollmentStatus.ACTIVE,
  });

  try {
    await recordPayment({
      ...paymentInput,
      enrollmentId: enrollment.id,
    });
    await redeemIfPresent(enrollment.id, input.currency, promoCodeRedemption);
  } catch (e) {
    const raced = await prisma.payment.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
        },
      },
      select: { enrollmentId: true },
    });
    if (raced) return raced.enrollmentId;
    throw e;
  }

  return enrollment.id;
};

export const findEnrollmentForCheckout = async (
  contactId: string,
  productId: string
): Promise<string | null> => {
  const row = await prisma.enrollment.findFirst({
    where: {
      contactId,
      productId,
      status: {
        in: [
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.COMPLETED,
          EnrollmentStatus.PENDING_PAYMENT,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
};
