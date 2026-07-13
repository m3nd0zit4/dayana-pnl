const PREFIX = "chk:";

/**
 * PayPal custom_id / MP external_reference for unpaid checkout (contact +
 * plan, no enrollment yet). When a promo code was applied, the code and the
 * discount actually baked into the charged amount travel along too — the
 * capture/webhook step reads them back to compute the SAME expected amount
 * used at creation, rather than re-validating the code (which could have
 * expired or hit its redemption cap in the few minutes between creating the
 * order and the customer completing payment, wrongly rejecting or
 * mis-crediting a payment that was already correctly charged).
 */
export const encodeCheckoutReference = (
  contactId: string,
  planId: string,
  promo?: { code: string; discountMinor: number }
): string =>
  promo
    ? `${PREFIX}${contactId}:${planId}:${promo.code}:${promo.discountMinor}`
    : `${PREFIX}${contactId}:${planId}`;

export const parseCheckoutReference = (
  value: string
): {
  contactId: string;
  planId: string;
  promoCode?: string;
  discountMinor?: number;
} | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const rest = trimmed.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 2 && parts.length !== 4) return null;

  const contactId = parts[0].trim();
  const planId = parts[1].trim();
  if (!contactId || !planId) return null;

  if (parts.length === 2) return { contactId, planId };

  const promoCode = parts[2].trim();
  const discountMinor = Number(parts[3]);
  if (!promoCode || !Number.isFinite(discountMinor)) return null;
  return { contactId, planId, promoCode, discountMinor };
};

export const isCheckoutReference = (value: string): boolean =>
  parseCheckoutReference(value) !== null;
