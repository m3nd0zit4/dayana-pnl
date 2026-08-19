import { prisma } from "@/lib/db";

export type ResolvedLemonSqueezyVariant = {
  variantId: string;
  /** `true` = variante de suscripción; decide qué webhook registra el pago. */
  subscription: boolean;
  productTitle: string;
};

/**
 * Resuelve la variante de Lemon Squeezy de un plan.
 *
 * Devuelve null si el producto nunca se sincronizó con LS; quien llama lo
 * convierte en 400 en vez de inventar una variante — un checkout contra una
 * variante equivocada cobra el importe de otro producto.
 */
export const resolveLemonSqueezyVariant = async (
  planId: string
): Promise<ResolvedLemonSqueezyVariant | null> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: {
      title: true,
      isActive: true,
      isCourseContent: true,
      lemonSqueezyVariantId: true,
      lemonSqueezySubscription: true,
    },
  });

  if (!product || !product.isActive || product.isCourseContent) return null;
  if (!product.lemonSqueezyVariantId) return null;

  return {
    variantId: product.lemonSqueezyVariantId,
    subscription: product.lemonSqueezySubscription,
    productTitle: product.title,
  };
};

/** ¿El plan se vende como suscripción en LS? Lo usa el webhook para decidir
 *  si `order_created` le corresponde o si lo cubre la suscripción. */
export const isLemonSqueezySubscriptionPlan = async (
  planId: string
): Promise<boolean> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: { lemonSqueezySubscription: true },
  });
  return product?.lemonSqueezySubscription ?? false;
};
