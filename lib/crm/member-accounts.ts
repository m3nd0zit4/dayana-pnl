import crypto from "crypto";
import { ContactSource, type Contact, type MemberAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStaffByEmail } from "@/lib/crm/staff";

/**
 * Google sign-ups have no phone yet. Unlike "+pending" checkout placeholders
 * (hidden from CRM lists and purged), these contacts must stay visible as leads.
 */
export const GOOGLE_PLACEHOLDER_PHONE_PREFIX = "+google";

/** Same idea as GOOGLE_PLACEHOLDER_PHONE_PREFIX, for open email/password signup. */
export const EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX = "+signup";

export type MemberWithContact = {
  contact: Contact;
  account: MemberAccount | null;
};

export const getMemberByEmail = async (
  email: string
): Promise<MemberWithContact | null> => {
  const contact = await prisma.contact.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { memberAccount: true },
  });
  if (!contact) return null;
  const { memberAccount, ...rest } = contact;
  return { contact: rest as Contact, account: memberAccount };
};

export const getMemberByContactId = async (
  contactId: string
): Promise<MemberWithContact | null> => {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { memberAccount: true },
  });
  if (!contact) return null;
  const { memberAccount, ...rest } = contact;
  return { contact: rest as Contact, account: memberAccount };
};

export const getMemberAccountByGoogleSub = async (googleSub: string) =>
  prisma.memberAccount.findUnique({
    where: { googleSub },
    include: { contact: true },
  });

export const setMemberPassword = async (
  contactId: string,
  passwordHash: string
): Promise<MemberAccount> =>
  prisma.memberAccount.upsert({
    where: { contactId },
    create: { contactId, passwordHash, emailVerifiedAt: new Date() },
    update: { passwordHash, emailVerifiedAt: new Date() },
  });

export const touchMemberLogin = async (memberAccountId: string) => {
  await prisma.memberAccount.update({
    where: { id: memberAccountId },
    data: { lastLoginAt: new Date() },
  });
};

/**
 * Google sign-in: links the Google identity to the Contact matching the
 * verified email, creating a lead Contact when the email is unknown.
 * Throws when the email belongs to a staff user — staff must use credentials.
 */
export const upsertMemberAccountForGoogle = async (input: {
  email: string;
  name?: string | null;
  googleSub: string;
}): Promise<MemberAccount> => {
  const email = input.email.trim().toLowerCase();

  const staff = await getStaffByEmail(email);
  if (staff) {
    throw new Error("STAFF_EMAIL_GOOGLE_FORBIDDEN");
  }

  let contact = await prisma.contact.findUnique({ where: { email } });
  if (!contact) {
    const name = input.name?.trim() || email.split("@")[0];
    const [firstName, ...restName] = name.split(/\s+/);
    contact = await prisma.contact.create({
      data: {
        email,
        firstName: firstName || email.split("@")[0],
        lastName: restName.length > 0 ? restName.join(" ") : null,
        displayName: name,
        phoneE164: `${GOOGLE_PLACEHOLDER_PHONE_PREFIX}:${crypto.randomUUID()}`,
        source: ContactSource.WEB,
        sourceDetail: "google-oauth",
      },
    });
  }

  return prisma.memberAccount.upsert({
    where: { contactId: contact.id },
    create: {
      contactId: contact.id,
      googleSub: input.googleSub,
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    },
    update: {
      googleSub: input.googleSub,
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    },
  });
};

/**
 * Open self-service signup: anyone can create a portal account with just an
 * email (no prior enrollment/payment required — access to course content is
 * gated separately by membership.isCurrent once logged in). Creates the lead
 * Contact if the email is unknown; the MemberAccount itself is created later
 * once they set a password via the invite-token flow (setMemberPassword).
 * Throws when the email belongs to a staff user.
 */
export const getOrCreateContactForEmailSignup = async (
  email: string,
  name?: string | null
): Promise<Contact> => {
  const normalized = email.trim().toLowerCase();

  const staff = await getStaffByEmail(normalized);
  if (staff) {
    throw new Error("STAFF_EMAIL_SIGNUP_FORBIDDEN");
  }

  const existing = await prisma.contact.findUnique({ where: { email: normalized } });
  if (existing) return existing;

  const trimmedName = name?.trim();
  const [firstName, ...restName] = trimmedName ? trimmedName.split(/\s+/) : [];

  return prisma.contact.create({
    data: {
      email: normalized,
      firstName: firstName || normalized.split("@")[0],
      lastName: restName.length > 0 ? restName.join(" ") : null,
      displayName: trimmedName || null,
      phoneE164: `${EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX}:${crypto.randomUUID()}`,
      source: ContactSource.WEB,
      sourceDetail: "member-signup",
    },
  });
};
