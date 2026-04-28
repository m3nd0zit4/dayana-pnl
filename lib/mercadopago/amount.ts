import type { Plan } from "../plans";
import {
  grossUpInt,
  grossUpUsd,
  mercadoPagoFee,
  type FeeBreakdown,
} from "../pricing/fees";

/**
 * Mercado Pago preference item amount (server-only).
 * Devuelve el NETO + COMISIÓN por separado, así el checkout muestra el desglose.
 */
export function mercadoPagoItemAmount(plan: Plan): {
  net: number;
  fee: number;
  gross: number;
  currency_id: string;
} {
  const currency = (process.env.MERCADOPAGO_CURRENCY ?? "USD").toUpperCase();
  if (currency === "COP") {
    const rate = Number(process.env.MERCADOPAGO_USD_TO_COP ?? "4000");
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("MERCADOPAGO_USD_TO_COP must be a positive number");
    }
    const netCop = Math.round(plan.amountUsd * rate);
    const breakdown: FeeBreakdown = grossUpInt(netCop, mercadoPagoFee());
    return { ...breakdown, currency_id: "COP" };
  }
  const breakdown = grossUpUsd(plan.amountUsd, mercadoPagoFee());
  return { ...breakdown, currency_id: "USD" };
}

export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
