import { ContactSource } from "@prisma/client";
import { upsertContactByPhone } from "./contacts";
import { parseCheckoutContactFields } from "../validations/checkout-contact";

export class CheckoutContactError extends Error {
  constructor(
    message: string,
    readonly code:
      | "CONSENT_REQUIRED"
      | "INVALID_PHONE"
      | "MISSING_PHONE"
      | "MISSING_EMAIL"
      | "INVALID_EMAIL"
      | "INVALID_CONTACT"
  ) {
    super(message);
    this.name = "CheckoutContactError";
  }
}

export type ResolveCheckoutContactInput = {
  /** Reuse contact from a prior step in the same checkout session. */
  contactId?: string;
  phone?: string;
  phoneCountry?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  countryIso?: string;
  consentData?: boolean;
};

export type ResolveCheckoutContactResult = {
  contactId: string;
  created: boolean;
};

export const resolveCheckoutContact = async (
  input: ResolveCheckoutContactInput
): Promise<ResolveCheckoutContactResult> => {
  const parsed = parseCheckoutContactFields({
    contactId: input.contactId,
    phone: input.phone,
    phoneCountry: input.phoneCountry,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    consentData: input.consentData === true ? true : undefined,
  });

  if (!parsed.ok) {
    throw new CheckoutContactError(parsed.message, parsed.code);
  }

  const data = parsed.data;

  try {
    const { contact, created } = await upsertContactByPhone({
      ...(data.contactId ? { contactId: data.contactId } : {}),
      phone: data.phone,
      phoneCountry: data.phoneCountry,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      countryIso: input.countryIso,
      source: ContactSource.WEB,
      consentData: true,
    });

    return { contactId: contact.id, created };
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_PHONE") {
      throw new CheckoutContactError(
        "Número de teléfono inválido",
        "INVALID_PHONE"
      );
    }
    throw e;
  }
};

export const checkoutContactErrorStatus = (
  code: CheckoutContactError["code"]
): number => {
  switch (code) {
    case "CONSENT_REQUIRED":
    case "MISSING_PHONE":
    case "INVALID_PHONE":
    case "MISSING_EMAIL":
    case "INVALID_EMAIL":
    case "INVALID_CONTACT":
      return 400;
    default:
      return 400;
  }
};
