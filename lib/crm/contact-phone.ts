/**
 * Placeholder phone conventions. A Contact.phoneE164 can hold three kinds of
 * sentinel instead of a real number:
 * - "+pending:…"  checkout ghost — hidden from the CRM entirely
 *                 (see checkout-placeholder.ts).
 * - "+google:…"   account created via Google sign-in; phone never captured.
 * - "+signup:…"   account created via direct email signup; phone never captured.
 *
 * The last two are REAL contacts (leads) — they must show in the CRM, but
 * their placeholder must never be rendered as if it were a phone number.
 */
const UNKNOWN_PHONE_PREFIXES = ["+pending", "+google:", "+signup:"];

/** True when the stored value is an actual phone number, not a sentinel. */
export const hasRealContactPhone = (phone: string): boolean =>
  !UNKNOWN_PHONE_PREFIXES.some((p) => phone.startsWith(p));

/** The phone for display/WhatsApp, or null when the contact has none yet. */
export const displayContactPhone = (phone: string): string | null =>
  hasRealContactPhone(phone) ? phone : null;

/** The confirmation value the delete dialog must show/collect for a contact:
 *  the real phone, or (Google/email-signup leads with no captured number)
 *  their full name instead. Client-safe — no server-only imports. */
export const contactDeleteConfirmationTarget = (contact: {
  phoneE164: string;
  firstName: string;
  lastName: string | null;
}): { kind: "phone" | "name"; value: string } =>
  hasRealContactPhone(contact.phoneE164)
    ? { kind: "phone", value: contact.phoneE164 }
    : {
        kind: "name",
        value: `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
      };
