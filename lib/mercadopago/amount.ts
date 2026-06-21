import type { Plan } from "../plans";
import {
  grossUpInt,
  grossUpUsd,
  mercadoPagoFee,
  type FeeBreakdown,
} from "../pricing/fees";
import {
  getMercadoPagoSiteCurrency,
  mercadoPagoCheckoutUsesCop,
  type MercadoPagoCurrencyId,
} from "./currency";

export type MercadoPagoItemAmount = FeeBreakdown & {
  currency_id: MercadoPagoCurrencyId;
  /** USD breakdown when checkout settles in COP but catalog is USD. */
  referenceUsd?: FeeBreakdown;
};

/**
 * Mercado Pago preference item amount (server-only).
 * Devuelve el NETO + COMISIÓN por separado, así el checkout muestra el desglose.
 */
export function mercadoPagoItemAmount(
  plan: Plan,
  usdToCopRate: number
): MercadoPagoItemAmount {
  const siteCurrency = getMercadoPagoSiteCurrency();
  const fee = mercadoPagoFee();

  if (mercadoPagoCheckoutUsesCop()) {
    const netCop = Math.round(plan.amountUsd * usdToCopRate);
    const breakdown = grossUpInt(netCop, fee);
    const result: MercadoPagoItemAmount = {
      ...breakdown,
      currency_id: "COP",
    };
    if (siteCurrency === "USD") {
      result.referenceUsd = grossUpUsd(plan.amountUsd, fee);
    }
    return result;
  }

  if (siteCurrency === "COP") {
    const netCop = Math.round(plan.amountUsd * usdToCopRate);
    const breakdown = grossUpInt(netCop, fee);
    return { ...breakdown, currency_id: "COP" };
  }

  const breakdown = grossUpUsd(plan.amountUsd, fee);
  return { ...breakdown, currency_id: "USD" };
}

export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
