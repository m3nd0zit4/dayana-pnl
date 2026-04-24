import type { Plan } from "../plans";

/** Mercado Pago preference item amount (server-only). */
export function mercadoPagoItemAmount(plan: Plan): {
  unit_price: number;
  currency_id: string;
} {
  const currency = (process.env.MERCADOPAGO_CURRENCY ?? "USD").toUpperCase();
  if (currency === "COP") {
    const rate = Number(process.env.MERCADOPAGO_USD_TO_COP ?? "4000");
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("MERCADOPAGO_USD_TO_COP must be a positive number");
    }
    return {
      unit_price: Math.round(plan.amountUsd * rate),
      currency_id: "COP",
    };
  }
  return { unit_price: plan.amountUsd, currency_id: "USD" };
}

export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
