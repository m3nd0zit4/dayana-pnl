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

export type UpdateMemberProfileInput = {
  firstName: string;
  lastName?: string | null;
  /** Already validated E164 (+573001234567). Omit/null = keep current phone. */
  phoneE164?: string | null;
  phoneCountryIso?: string | null;
};

/** Self-service profile edit from the member portal. Email is the login
 * identity and is deliberately NOT editable here. */
export const updateMemberProfile = async (
  contactId: string,
  input: UpdateMemberProfileInput
): Promise<Contact> => {
  if (input.phoneE164) {
    const existing = await prisma.contact.findUnique({
      where: { phoneE164: input.phoneE164 },
      select: { id: true },
    });
    if (existing && existing.id !== contactId) {
      throw new Error("PHONE_TAKEN");
    }
  }

  return prisma.contact.update({
    where: { id: contactId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName?.trim() || null,
      ...(input.phoneE164
        ? {
            phoneE164: input.phoneE164,
            phoneCountryIso: input.phoneCountryIso ?? null,
          }
        : {}),
    },
  });
};

export type InviteContactResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "no_email" | "has_account" };

/**
 * Invites a contact to the member portal: creates a single-use INVITE token
 * and emails the set-your-password link. Shared by every surface that
 * auto-creates accounts (home lead form, post-payment inngest step). Skips
 * silently when the contact has no email or already has a MemberAccount.
 * The email dispatch itself is gated by NOTIFICATIONS_ENABLED and always
 * records a NotificationDelivery row (see lib/notifications/dispatch.ts).
 */
export const inviteContactToPortal = async (
  contactId: string,
  options?: { callbackUrl?: string | null }
): Promise<InviteContactResult> => {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      email: true,
      firstName: true,
      memberAccount: { select: { id: true } },
    },
  });
  if (!contact?.email) return { status: "skipped", reason: "no_email" };
  if (contact.memberAccount) return { status: "skipped", reason: "has_account" };

  const { createMemberAuthToken } = await import("@/lib/auth/member-tokens");
  const { sendMemberInviteEmail } = await import(
    "@/lib/notifications/member-emails"
  );

  const rawToken = await createMemberAuthToken({
    contactId: contact.id,
    purpose: "INVITE",
  });
  await sendMemberInviteEmail({
    contactId: contact.id,
    firstName: contact.firstName,
    rawToken,
    callbackUrl: options?.callbackUrl ?? null,
  });
  return { status: "sent" };
};

const DELETION_REQUEST_TAG_SLUG = "solicitud-eliminar-cuenta";

/**
 * Marks a member's account-deletion request for staff to process in the CRM:
 * tags the contact and appends a dated note. Idempotent — repeating the
 * request doesn't duplicate the tag and only adds another note line.
 */
export const requestMemberAccountDeletion = async (
  contactId: string
): Promise<void> => {
  const tag = await prisma.tag.upsert({
    where: { slug: DELETION_REQUEST_TAG_SLUG },
    create: {
      slug: DELETION_REQUEST_TAG_SLUG,
      label: "Solicitud de eliminación de cuenta",
    },
    update: {},
  });

  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { contactId, tagId: tag.id },
    update: {},
  });

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { notes: true },
  });
  const stamp = new Date().toLocaleDateString("es-CO", { dateStyle: "medium" });
  const line = `[${stamp}] La miembro solicitó eliminar su cuenta desde el portal.`;
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      notes: contact?.notes ? `${contact.notes}\n${line}` : line,
    },
  });
};

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
