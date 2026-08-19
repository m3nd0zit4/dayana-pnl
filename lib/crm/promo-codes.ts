import type { PromoCode } from "@prisma/client";
import { prisma } from "../db";

const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

export type PromoValidationError =
  | "not_found"
  | "inactive"
  | "expired"
  | "max_redemptions"
  | "currency_unavailable"
  | "product_not_eligible";

export type PromoValidation =
  | { ok: true; promoCode: PromoCode; discountMinor: number }
  | { ok: false; error: PromoValidationError };

/**
 * ¿Hay algún código que esta persona pudiera llegar a usar en este plan?
 *
 * Sirve para no enseñar el campo "código promocional" cuando no hay ninguno
 * vivo: un campo vacío que nunca acepta nada sólo siembra la duda de que se
 * está pagando de más, y manda a la clienta a buscar por ahí un cupón que no
 * existe en vez de terminar la compra.
 *
 * Deliberadamente NO comprueba el importe: aquí sólo interesa la existencia,
 * y validar el descuento contra el total es trabajo de `validatePromoCode`
 * cuando la clienta escriba el código.
 */
export const hasUsablePromoCode = async (
  productId?: string | null
): Promise<boolean> => {
  const count = await prisma.promoCode.count({
    where: {
      isActive: true,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        {
          OR: [
            // Sin productos asociados = vale para todo el catálogo.
            { products: { none: {} } },
            ...(productId ? [{ products: { some: { productId } } }] : []),
          ],
        },
      ],
    },
  });
  return count > 0;
};

/**
 * `baseAmountMinor` is the NET price (before processor fee gross-up), in the
 * given currency's minor units — USD cents, COP whole pesos (COP has no
 * cents; see CLAUDE.md). PERCENT codes are computed against it; FIXED_AMOUNT
 * codes only apply if the code has an amount configured for that currency.
 *
 * `productId` es el producto que se está comprando (`Plan.id === Product.id`).
 * Si el código tiene productos asociados y este no está entre ellos, no
 * aplica. **Sin productos asociados el código vale para todo** — esa es la
 * regla que mantiene funcionando a los códigos que ya estaban emitidos.
 * Omitirlo salta la comprobación, para los llamantes que aún no tienen
 * producto en mano.
 */
export const validatePromoCode = async (
  rawCode: string,
  currency: "USD" | "COP",
  baseAmountMinor: number,
  productId?: string | null
): Promise<PromoValidation> => {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "not_found" };

  const promoCode = await prisma.promoCode.findUnique({
    where: { code },
    include: { products: { select: { productId: true } } },
  });
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
  // Lista vacía = sin restricción. Comprobarlo antes de calcular el descuento
  // evita devolver un importe que luego no se puede aplicar.
  if (promoCode.products.length > 0) {
    if (!productId) return { ok: false, error: "product_not_eligible" };
    const eligible = promoCode.products.some((p) => p.productId === productId);
    if (!eligible) return { ok: false, error: "product_not_eligible" };
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
