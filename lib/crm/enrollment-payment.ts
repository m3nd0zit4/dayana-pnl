import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { isPlaceholderContactPhone } from "./checkout-placeholder";

export class EnrollmentPaymentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "PLAN_MISMATCH"
      | "ALREADY_PAID"
  ) {
    super(message);
    this.name = "EnrollmentPaymentError";
  }
}

export type PayableEnrollment = {
  id: string;
  productId: string;
  status: EnrollmentStatus;
};

/**
 * Ensures an enrollment can accept payment for the given plan.
 * Throws EnrollmentPaymentError on violation.
 */
export const assertEnrollmentPayable = async (
  enrollmentId: string,
  planId: string
): Promise<PayableEnrollment> => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      productId: true,
      status: true,
      contact: { select: { phoneE164: true } },
    },
  });

  if (!enrollment) {
    throw new EnrollmentPaymentError(
      "Enrollment not found",
      "NOT_FOUND"
    );
  }

  if (isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
    throw new EnrollmentPaymentError(
      "Enrollment contact is not identified",
      "INVALID_STATUS"
    );
  }

  if (enrollment.status !== EnrollmentStatus.PENDING_PAYMENT) {
    throw new EnrollmentPaymentError(
      "Enrollment is not pending payment",
      "INVALID_STATUS"
    );
  }

  if (enrollment.productId !== planId) {
    throw new EnrollmentPaymentError(
      "Enrollment plan does not match requested plan",
      "PLAN_MISMATCH"
    );
  }

  const approved = await prisma.payment.findFirst({
    where: {
      enrollmentId: enrollment.id,
      status: PaymentStatus.APPROVED,
    },
    select: { id: true },
  });

  if (approved) {
    throw new EnrollmentPaymentError(
      "Enrollment already has an approved payment",
      "ALREADY_PAID"
    );
  }

  return enrollment;
};

/** PayPal capture must match expected gross (USD, 2 decimals). */
export const assertPayPalCaptureAmount = (
  amountMinor: number,
  currency: string,
  expectedGrossUsd: number
): void => {
  if (currency.toUpperCase() !== "USD") {
    throw new EnrollmentPaymentError(
      "Unexpected capture currency",
      "PLAN_MISMATCH"
    );
  }
  const expectedMinor = Math.round(expectedGrossUsd * 100);
  if (amountMinor !== expectedMinor) {
    throw new EnrollmentPaymentError(
      "Capture amount does not match plan price",
      "PLAN_MISMATCH"
    );
  }
};

export const enrollmentPaymentErrorStatus = (
  code: EnrollmentPaymentError["code"]
): number => {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_STATUS":
    case "PLAN_MISMATCH":
    case "ALREADY_PAID":
      return 409;
    default:
      return 400;
  }
};
