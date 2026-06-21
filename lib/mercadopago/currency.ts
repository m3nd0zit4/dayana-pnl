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
 * When the site is priced in USD, we convert explicitly with MERCADOPAGO_USD_TO_COP
 * instead of sending USD and letting MP apply its own FX at checkout.
 */
export function mercadoPagoCheckoutUsesCop(): boolean {
  return getMercadoPagoSellerCountry() === "CO";
}

export function getUsdToCopRate(): number {
  const rate = Number(process.env.MERCADOPAGO_USD_TO_COP ?? "4000");
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("MERCADOPAGO_USD_TO_COP must be a positive number");
  }
  return rate;
}
