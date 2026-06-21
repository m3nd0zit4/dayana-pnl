export type MercadoPagoCurrencyId = "USD" | "COP";

/** Catalog / site pricing mode from env (USD by default). */
export function getMercadoPagoSiteCurrency(): MercadoPagoCurrencyId {
  return (process.env.MERCADOPAGO_CURRENCY ?? "USD").toUpperCase() === "COP"
    ? "COP"
    : "USD";
}

/** Seller country for Checkout Pro (Colombia by default for .com.co accounts). */
export function getMercadoPagoSellerCountry(): string {
  return (process.env.MERCADOPAGO_SELLER_COUNTRY ?? "CO")
    .trim()
    .toUpperCase();
}

/**
 * Mercado Pago Colombia always settles checkout in COP.
 * When the site is priced in USD, we convert with the same USD→COP rate as la web (CRM / env).
 */
export function mercadoPagoCheckoutUsesCop(): boolean {
  return getMercadoPagoSellerCountry() === "CO";
}
