const PREFIX = "chk:";

/** PayPal custom_id / MP external_reference for unpaid checkout (contact + plan, no enrollment). */
export const encodeCheckoutReference = (
  contactId: string,
  planId: string
): string => `${PREFIX}${contactId}:${planId}`;

export const parseCheckoutReference = (
  value: string
): { contactId: string; planId: string } | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const rest = trimmed.slice(PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const contactId = rest.slice(0, sep).trim();
  const planId = rest.slice(sep + 1).trim();
  if (!contactId || !planId) return null;
  return { contactId, planId };
};

export const isCheckoutReference = (value: string): boolean =>
  parseCheckoutReference(value) !== null;
