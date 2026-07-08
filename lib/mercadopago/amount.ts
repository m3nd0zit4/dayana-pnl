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
 *
 * El monto COP es SIEMPRE el precio COP explícito del CRM — nunca una
 * conversión automática desde USD. Sin fila COP no hay checkout en COP
 * (lanza `no_cop_price`); la web tampoco muestra el plan a Colombia en
 * ese caso, así que lo mostrado y lo cobrado nunca divergen.
 */
export function mercadoPagoItemAmount(plan: Plan): MercadoPagoItemAmount {
  const siteCurrency = getMercadoPagoSiteCurrency();
  const fee = mercadoPagoFee();

  if (mercadoPagoCheckoutUsesCop() || siteCurrency === "COP") {
    if (plan.amountCop == null || plan.amountCop <= 0) {
      throw new Error("no_cop_price");
    }
    const breakdown = grossUpInt(plan.amountCop, fee);
    const result: MercadoPagoItemAmount = {
      ...breakdown,
      currency_id: "COP",
    };
    if (siteCurrency === "USD" && plan.amountUsd > 0) {
      result.referenceUsd = grossUpUsd(plan.amountUsd, fee);
    }
    return result;
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
