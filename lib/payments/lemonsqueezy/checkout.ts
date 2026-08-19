import { siteBaseUrl } from "@/lib/mercadopago/amount";
import { encodeCheckoutReference } from "@/lib/crm/checkout-reference";
import { lemonSqueezyRequest, lemonSqueezyStoreId } from "./client";

/**
 * Clave del dato custom que viaja al webhook como `meta.custom_data.checkoutRef`.
 * LS guarda el custom data de forma permanente, así que sobrevive a todas las
 * renovaciones de una suscripción.
 */
export const CHECKOUT_REF_KEY = "checkoutRef";

export type CreateLemonSqueezyCheckoutInput = {
  contactId: string;
  planId: string;
  variantId: string;
  /** `true` = variante de suscripción: NO se manda custom_price. */
  subscription: boolean;
  /**
   * Importe final en centavos USD, con gross-up de comisión y con el descuento
   * ya restado. Se ignora en variantes de suscripción.
   */
  amountCents: number;
  promo?: { code: string; discountMinor: number };
  email?: string;
  name?: string;
};

export type CreatedLemonSqueezyCheckout = {
  url: string;
  checkoutReference: string;
};

type CheckoutResponse = {
  data?: { id?: string; attributes?: { url?: string } };
};

export const createLemonSqueezyCheckout = async (
  input: CreateLemonSqueezyCheckoutInput
): Promise<CreatedLemonSqueezyCheckout> => {
  const storeId = lemonSqueezyStoreId();
  if (!storeId) {
    throw new Error("[lemonsqueezy] LEMONSQUEEZY_STORE_ID is not set");
  }

  const checkoutReference = encodeCheckoutReference(
    input.contactId,
    input.planId,
    input.promo
  );

  const base = siteBaseUrl();
  const redirectUrl = `${base}/pago/exito?ls=1&ref=${encodeURIComponent(
    checkoutReference
  )}`;

  const attributes: Record<string, unknown> = {
    checkout_data: {
      // Los valores custom se devuelven como strings; la referencia ya lo es.
      custom: { [CHECKOUT_REF_KEY]: checkoutReference },
      ...(input.email ? { email: input.email } : {}),
      ...(input.name ? { name: input.name } : {}),
    },
    product_options: {
      redirect_url: redirectUrl,
    },
  };

  // `custom_price` sólo en pago único. En variantes de suscripción el soporte
  // no está documentado, así que la mensualidad cobra el precio configurado en
  // LS y el descuento, si lo hubiera, tendría que ir como discount code.
  if (!input.subscription) {
    attributes.custom_price = input.amountCents;
  }

  const body = {
    data: {
      type: "checkouts",
      attributes,
      relationships: {
        store: { data: { type: "stores", id: String(storeId) } },
        variant: { data: { type: "variants", id: String(input.variantId) } },
      },
    },
  };

  const res = await lemonSqueezyRequest<CheckoutResponse>("/checkouts", {
    method: "POST",
    body,
  });

  const url = res.data?.attributes?.url;
  if (!url) {
    throw new Error("[lemonsqueezy] checkout created without a url");
  }

  return { url, checkoutReference };
};
