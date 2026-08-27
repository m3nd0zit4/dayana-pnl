/**
 * Productos donde un código promocional no aplica nunca.
 *
 * La mensualidad se cobra por un plan de PayPal o de Mercado Pago, y un plan
 * cobra una cifra fija. Descontar exigiría un plan por código: PayPal lo
 * permitiría con un ciclo de prueba, pero **Mercado Pago no sabe cobrar un
 * primer mes más barato** —sólo mes gratis—, así que en Colombia haría falta
 * crear un plan por cupón en una plataforma donde los planes no se borran
 * jamás. Se descartó por eso.
 *
 * Vive en código y no como filas de `PromoCodeProduct` porque la regla del
 * modelo es que **un código sin productos asociados vale para todo el
 * catálogo**: cualquier cupón nuevo volvería a alcanzar al curso sin que nadie
 * se diera cuenta. Aquí no hay forma de olvidarlo.
 *
 * Módulo aparte y sin dependencias a propósito: lo necesita tanto el servidor
 * (para rechazar el código) como el panel (para no ofrecer un producto que
 * nunca va a funcionar), y `lib/crm/promo-codes.ts` arrastra Prisma.
 */
export const PROMO_EXCLUDED_PRODUCT_IDS = ["course-live"] as const;

export const isPromoExcludedProduct = (productId?: string | null): boolean =>
  productId != null &&
  (PROMO_EXCLUDED_PRODUCT_IDS as readonly string[]).includes(productId);
