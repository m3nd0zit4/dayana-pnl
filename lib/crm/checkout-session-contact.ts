import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getStaffById } from "./staff";
import { PLACEHOLDER_PHONE_PREFIX } from "./checkout-placeholder";
import {
  GOOGLE_PLACEHOLDER_PHONE_PREFIX,
  EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX,
} from "./member-accounts";

export type SessionCheckoutPrefill = {
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneCountry?: string;
};

export type SessionCheckoutContact =
  | {
      /** Contact exists and has a real phone — checkout can skip the form. */
      status: "complete";
      contactId: string;
      prefill: SessionCheckoutPrefill;
    }
  | {
      /** Session exists but the contact is missing a real phone (or a staff
       *  user has no CRM contact yet) — show the form, prefilled, and anchor
       *  the submit to contactId when present. */
      status: "incomplete";
      contactId: string | null;
      prefill: SessionCheckoutPrefill;
    };

/** Placeholder phones ("+pending", "+google:", "+signup:") aren't dialable —
 *  a checkout keyed on them must still ask for the real number. */
export const isRealContactPhone = (phoneE164: string): boolean =>
  phoneE164.startsWith("+") &&
  !phoneE164.startsWith(PLACEHOLDER_PHONE_PREFIX) &&
  !phoneE164.startsWith(GOOGLE_PLACEHOLDER_PHONE_PREFIX) &&
  !phoneE164.startsWith(EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX);

/**
 * Resolves the CRM contact a checkout should register to, from the current
 * session (member or staff). Server-trusted: never reads client-posted ids.
 * Returns null when there is no authenticated session.
 */
export const resolveSessionCheckoutContact =
  async (): Promise<SessionCheckoutContact | null> => {
    const session = await auth();
    const user = session?.user;
    if (!user?.kind || !user.id) return null;

    if (user.kind === "member") {
      const contact = await prisma.contact.findUnique({
        where: { id: user.id },
      });
      if (!contact) return null;

      const prefill: SessionCheckoutPrefill = {
        email: contact.email ?? undefined,
        firstName: contact.firstName,
        lastName: contact.lastName ?? undefined,
        phoneCountry: contact.phoneCountryIso ?? undefined,
      };
      return isRealContactPhone(contact.phoneE164)
        ? { status: "complete", contactId: contact.id, prefill }
        : { status: "incomplete", contactId: contact.id, prefill };
    }

    // Staff session: pay as the CRM contact sharing the staff email.
    const staff = await getStaffById(user.id);
    if (!staff?.isActive) return null;

    const contact = await prisma.contact.findUnique({
      where: { email: staff.email.toLowerCase() },
    });
    if (!contact) {
      const name = staff.displayName?.trim() || staff.email.split("@")[0];
      const [firstName, ...rest] = name.split(/\s+/);
      return {
        status: "incomplete",
        contactId: null,
        prefill: {
          email: staff.email,
          firstName: firstName || undefined,
          lastName: rest.length > 0 ? rest.join(" ") : undefined,
        },
      };
    }

    const prefill: SessionCheckoutPrefill = {
      email: contact.email ?? staff.email,
      firstName: contact.firstName,
      lastName: contact.lastName ?? undefined,
      phoneCountry: contact.phoneCountryIso ?? undefined,
    };
    return isRealContactPhone(contact.phoneE164)
      ? { status: "complete", contactId: contact.id, prefill }
      : { status: "incomplete", contactId: contact.id, prefill };
  };
