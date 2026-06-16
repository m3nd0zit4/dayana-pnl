import { ContactSource } from "@prisma/client";
import { upsertContactByPhone } from "./contacts";

export class CheckoutContactError extends Error {
  constructor(
    message: string,
    readonly code: "CONSENT_REQUIRED" | "INVALID_PHONE" | "MISSING_PHONE"
  ) {
    super(message);
    this.name = "CheckoutContactError";
  }
}

export type ResolveCheckoutContactInput = {
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
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!phone) {
    throw new CheckoutContactError(
      "Teléfono obligatorio para iniciar el pago",
      "MISSING_PHONE"
    );
  }

  if (!input.consentData) {
    throw new CheckoutContactError(
      "Debes aceptar el tratamiento de datos personales",
      "CONSENT_REQUIRED"
    );
  }

  try {
    const { contact, created } = await upsertContactByPhone({
      phone,
      phoneCountry: input.phoneCountry,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
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
      return 400;
    default:
      return 400;
  }
};
