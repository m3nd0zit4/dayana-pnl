/**
 * Arranca el pago sin formulario previo.
 *
 * Los dos proveedores obligan a dar email (PayPal siempre; Mercado Pago al
 * pagar) y lo devuelven en la captura o el webhook, así que pedir los datos
 * antes sólo restaba conversión. El contacto se crea temporal y se completa
 * con lo que reporte el pagador; el WhatsApp se pide después en /pago/exito.
 *
 * Devuelve un mensaje de error si no se pudo abrir. Si sale bien no devuelve:
 * la navegación se lleva la página.
 */
export type CheckoutProvider = "paypal" | "mercadopago";

const GENERIC_ERROR = "No se pudo abrir el pago. Intenta de nuevo.";

/**
 * Cómo quiere pagar quien compra por PayPal.
 *
 * - `card`: formulario de tarjeta, SIN cuenta de PayPal. Es el caso que se
 *   estaba perdiendo: por defecto PayPal aterriza en su pantalla de acceso y
 *   quien no tiene cuenta se da la vuelta.
 * - `wallet`: acceder con la cuenta de PayPal (saldo, o la tarjeta guardada).
 *
 * Se resuelve con el parámetro `fundingSource` de la URL de aprobación, que es
 * lo que de verdad decide la pantalla. Ni `landing_page` en la orden ni el
 * ajuste "Pago como usuario no registrado" de la cuenta lo consiguen: el
 * primero lo ignora si reconoce a la compradora y el segundo pertenece al
 * sistema de botones antiguo, no a Orders v2 — comprobado contra la pasarela.
 */
export type PayPalFunding = "card" | "wallet";

export const startCheckout = async (
  provider: CheckoutProvider,
  planId: string,
  options: {
    promoCode?: string;
    funding?: PayPalFunding;
    /**
     * Alta de mensualidad recurrente en lugar de cobro suelto.
     *
     * En Mercado Pago **sólo funciona con tarjeta**: su cobro recurrente no
     * puede debitar PSE, Nequi ni efectivo. Por eso en Colombia la suscripción
     * no reemplaza al pago suelto — se ofrecen las dos y la clienta elige.
     */
    subscribe?: boolean;
  } = {}
): Promise<string | null> => {
  const subscribing = options.subscribe === true;
  const endpoint = subscribing
    ? provider === "paypal"
      ? "/api/paypal/create-subscription"
      : "/api/mercadopago/create-subscription"
    : provider === "paypal"
      ? "/api/paypal/create-order"
      : "/api/mercadopago/create-preference";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        ...(options.promoCode ? { promoCode: options.promoCode } : {}),
        ...(provider === "mercadopago" ? { mode: "full" } : {}),
      }),
    });
    const data = (await res.json()) as {
      approveUrl?: string;
      init_point?: string;
      error?: string;
    };

    if (!res.ok) {
      if (data.error === "no_cop_price") {
        return "Este plan no está disponible para pago en Colombia.";
      }
      if (data.error === "invalid_promo_code") {
        return "Ese código promocional no es válido para este plan.";
      }
      if (data.error === "promo_not_supported") {
        // Un plan de PayPal cobra precio fijo: descontar exigiría un plan por
        // código. Mejor decirlo que cobrar el total en silencio.
        return "Los códigos promocionales no aplican a la suscripción mensual.";
      }
      if (data.error === "no_subscription_plan") {
        return "La suscripción no está disponible todavía. Escríbenos por WhatsApp.";
      }
      return GENERIC_ERROR;
    }

    // PayPal por redirección (`approve`/`payer-action`) y MP por `init_point`.
    const base = data.approveUrl ?? data.init_point;
    if (!base) return GENERIC_ERROR;

    /**
     * `fundingSource=card` pide la pantalla de tarjeta en vez del acceso.
     *
     * En el pago suelto está comprobado que funciona. En la suscripción PayPal
     * redirige de `billing/subscriptions` a su propio checkout y puede perder
     * el parámetro por el camino; se manda igual porque no estorba, y su flujo
     * ofrece "añadir tarjeta" de todos modos.
     */
    const target =
      provider === "paypal" && options.funding === "card"
        ? `${base}${base.includes("?") ? "&" : "?"}fundingSource=card`
        : base;

    window.location.assign(target);
    return null;
  } catch {
    return "Error de red. Intenta de nuevo.";
  }
};
