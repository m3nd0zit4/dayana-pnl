import {
  CheckoutContactError,
  resolveCheckoutContact,
  type ResolveCheckoutContactInput,
} from "./checkout-contact";
import { EnrollmentValidationError } from "./enrollments";

export type CheckoutContactBody = ResolveCheckoutContactInput & {
  contactId?: string;
  /** @deprecated Legacy pending enrollment from old checkout URLs */
  enrollmentId?: string;
};

export type BeginCheckoutContactInput = {
  planId: string;
  contact: CheckoutContactBody;
};

export type BeginCheckoutContactResult = {
  contactId: string;
  contactCreated: boolean;
};

/** Registers or updates the contact only — no enrollment until payment is approved. */
export async function beginCheckoutContact(
  input: BeginCheckoutContactInput
): Promise<BeginCheckoutContactResult> {
  const { contactId, created } = await resolveCheckoutContact(input.contact);
  return { contactId, contactCreated: created };
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
  if (e instanceof EnrollmentValidationError) {
    return { status: 400, error: e.code, message: e.message };
  }
  return {
    status: 503,
    error: "crm_unavailable",
    message: "No se pudo registrar tu contacto.",
  };
}
