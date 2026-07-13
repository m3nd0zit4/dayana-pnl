import type { PromoCode } from "@prisma/client";
import { prisma } from "../db";

const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

export type PromoValidationError =
  | "not_found"
  | "inactive"
  | "expired"
  | "max_redemptions"
  | "currency_unavailable";

export type PromoValidation =
  | { ok: true; promoCode: PromoCode; discountMinor: number }
  | { ok: false; error: PromoValidationError };

/**
 * `baseAmountMinor` is the NET price (before processor fee gross-up), in the
 * given currency's minor units — USD cents, COP whole pesos (COP has no
 * cents; see CLAUDE.md). PERCENT codes are computed against it; FIXED_AMOUNT
 * codes only apply if the code has an amount configured for that currency.
 */
export const validatePromoCode = async (
  rawCode: string,
  currency: "USD" | "COP",
  baseAmountMinor: number
): Promise<PromoValidation> => {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "not_found" };

  const promoCode = await prisma.promoCode.findUnique({ where: { code } });
  if (!promoCode) return { ok: false, error: "not_found" };
  if (!promoCode.isActive) return { ok: false, error: "inactive" };
  if (promoCode.expiresAt && promoCode.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired" };
  }
  if (
    promoCode.maxRedemptions != null &&
    promoCode.timesRedeemed >= promoCode.maxRedemptions
  ) {
    return { ok: false, error: "max_redemptions" };
  }

  let discountMinor: number;
  if (promoCode.discountType === "PERCENT") {
    discountMinor = Math.round(
      (baseAmountMinor * (promoCode.percentOff ?? 0)) / 100
    );
  } else {
    const fixed =
      currency === "USD"
        ? promoCode.amountOffUsdMinor
        : promoCode.amountOffCopMinor;
    if (fixed == null) return { ok: false, error: "currency_unavailable" };
    discountMinor = fixed;
  }

  return {
    ok: true,
    promoCode,
    discountMinor: Math.max(0, Math.min(discountMinor, baseAmountMinor)),
  };
};

/**
 * Records a redemption and bumps the counter. Called once per enrollment,
 * right after `fulfillCheckoutPayment` actually creates/records the payment
 * for the first time — never on webhook/return-page re-deliveries, since
 * those short-circuit before reaching this call. The unique constraint on
 * `enrollmentId` is a second idempotency net in case that guard is ever
 * bypassed; a duplicate is swallowed rather than treated as an error.
 */
export const redeemPromoCode = async (input: {
  promoCodeId: string;
  enrollmentId: string;
  currency: string;
  discountMinor: number;
}): Promise<void> => {
  try {
    await prisma.$transaction([
      prisma.promoCode.update({
        where: { id: input.promoCodeId },
        data: { timesRedeemed: { increment: 1 } },
      }),
      prisma.promoCodeRedemption.create({
        data: {
          promoCodeId: input.promoCodeId,
          enrollmentId: input.enrollmentId,
          currency: input.currency,
          discountMinor: input.discountMinor,
        },
      }),
    ]);
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code !== "P2002") throw e;
  }
};
