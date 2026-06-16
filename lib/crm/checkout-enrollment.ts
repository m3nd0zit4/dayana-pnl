import { prisma } from "../db";
import {
  CheckoutContactError,
  resolveCheckoutContact,
  type ResolveCheckoutContactInput,
} from "./checkout-contact";
import {
  createPendingPaymentEnrollment,
  EnrollmentValidationError,
} from "./enrollments";
import {
  assertEnrollmentPayable,
  EnrollmentPaymentError,
} from "./enrollment-payment";

export type CheckoutContactBody = ResolveCheckoutContactInput & {
  enrollmentId?: string;
};

export type BeginCheckoutEnrollmentInput = {
  planId: string;
  contact: CheckoutContactBody;
};

export type BeginCheckoutEnrollmentResult = {
  contactId: string;
  enrollmentId: string;
  createdEnrollment: boolean;
};

export async function beginCheckoutEnrollment(
  input: BeginCheckoutEnrollmentInput
): Promise<BeginCheckoutEnrollmentResult> {
  const { contactId } = await resolveCheckoutContact(input.contact);

  let enrollmentId =
    typeof input.contact.enrollmentId === "string"
      ? input.contact.enrollmentId.trim()
      : undefined;

  let createdEnrollment = false;

  if (enrollmentId) {
    await assertEnrollmentPayable(enrollmentId, input.planId);
    const row = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { contactId: true },
    });
    if (!row) {
      throw new EnrollmentPaymentError("Enrollment not found", "NOT_FOUND");
    }
    if (row.contactId !== contactId) {
      throw new EnrollmentPaymentError(
        "Enrollment does not belong to this contact",
        "INVALID_STATUS"
      );
    }
  } else {
    const enrollment = await createPendingPaymentEnrollment({
      contactId,
      productId: input.planId,
    });
    enrollmentId = enrollment.id;
    createdEnrollment = true;
  }

  return { contactId, enrollmentId, createdEnrollment };
}

export function mapCheckoutBeginError(e: unknown): {
  status: number;
  error: string;
  message: string;
} {
  if (e instanceof CheckoutContactError) {
    return {
      status: 400,
      error: e.code,
      message: e.message,
    };
  }
  if (e instanceof EnrollmentPaymentError) {
    const status =
      e.code === "NOT_FOUND" ? 404 : e.code === "INVALID_STATUS" ? 409 : 409;
    return { status, error: e.code, message: e.message };
  }
  if (e instanceof EnrollmentValidationError) {
    return { status: 400, error: e.code, message: e.message };
  }
  return {
    status: 503,
    error: "crm_unavailable",
    message: "No se pudo iniciar el registro del pago.",
  };
}
