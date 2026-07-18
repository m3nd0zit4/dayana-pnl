import {
  CheckoutContactError,
  resolveCheckoutContact,
  type ResolveCheckoutContactInput,
} from "./checkout-contact";
import { resolveSessionCheckoutContact } from "./checkout-session-contact";
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

/**
 * Contact resolution for the payment-creation routes. With `fromSession`,
 * the signed-in identity wins: a complete session contact is used directly
 * (no fields needed), an incomplete one anchors the posted fields to it,
 * and an expired session falls back to the plain posted-fields path.
 */
export async function resolveCheckoutContactIdForRequest(input: {
  planId: string;
  contact: CheckoutContactBody;
  fromSession?: boolean;
}): Promise<string> {
  if (input.fromSession === true) {
    const resolved = await resolveSessionCheckoutContact();
    if (resolved) {
      if (resolved.status === "complete") {
        return resolved.contactId;
      }
      const begun = await beginCheckoutContact({
        planId: input.planId,
        contact: {
          ...input.contact,
          contactId: resolved.contactId ?? undefined,
        },
      });
      return begun.contactId;
    }
  }

  const begun = await beginCheckoutContact({
    planId: input.planId,
    contact: input.contact,
  });
  return begun.contactId;
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
