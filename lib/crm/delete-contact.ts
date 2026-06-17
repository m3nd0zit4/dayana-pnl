import type { CountryCode } from "libphonenumber-js";
import { prisma } from "../db";
import { normalizePhone } from "../phone";
import { isPlaceholderContactPhone } from "./checkout-placeholder";

export const contactPhoneConfirmationMatches = (
  storedE164: string,
  input: string,
  defaultCountry: CountryCode = "CO"
): boolean => {
  const trimmed = input.trim();
  if (!trimmed) return false;

  if (trimmed === storedE164) return true;

  const normalized = normalizePhone(trimmed, defaultCountry);
  if (normalized?.phoneE164 === storedE164) return true;

  const storedDigits = storedE164.replace(/\D/g, "");
  const inputDigits = trimmed.replace(/\D/g, "");
  return storedDigits.length > 0 && storedDigits === inputDigits;
};

/**
 * Deletes a contact and all related CRM data (enrollments, payments, notebook,
 * tags, message logs, notifications) via DB cascades.
 */
export const deleteContactAndRelations = async (contactId: string) => {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      phoneE164: true,
      phoneCountryIso: true,
      countryIso: true,
    },
  });

  if (!contact) return null;

  if (isPlaceholderContactPhone(contact.phoneE164)) {
    throw new Error("PLACEHOLDER");
  }

  await prisma.$transaction(async (tx) => {
    await tx.enrollment.updateMany({
      where: { contactId },
      data: { parentEnrollmentId: null },
    });
    await tx.contact.delete({ where: { id: contactId } });
  });

  return contact;
};
