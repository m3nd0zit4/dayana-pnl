import { EnrollmentStatus, ProductKind } from "@prisma/client";
import { prisma } from "../db";
import { createEnrollment } from "./enrollments";
import { recordPayment, type RecordPaymentInput } from "./payments";

export type FulfillCheckoutPaymentInput = Omit<
  RecordPaymentInput,
  "enrollmentId"
> & {
  contactId: string;
  productId: string;
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

  const { contactId: _c, productId: _p, ...paymentInput } = input;

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
