import { PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/checkout-placeholder";
import { MAGNET_PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/magnets";

/**
 * A contact's phone as the tools may show it: `null` for the internal
 * placeholders (`+pending:…` from a checkout without a number, `+nophone…`
 * from a lead magnet), which are ids, not numbers.
 */
export const shownPhone = (phone: string | null | undefined): string | null =>
  !phone || phone.startsWith(PLACEHOLDER_PHONE_PREFIX) || phone.startsWith(MAGNET_PLACEHOLDER_PHONE_PREFIX) ? null : phone;
