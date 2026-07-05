"use client";

import { useSyncExternalStore } from "react";
import { buildWhatsAppUrl } from "../../../lib/contact";
import { formatCop, formatUsd, type Plan } from "../../../lib/plans";
import { usePayPalModal } from "../../context/PayPalModalContext";
import { useMercadoPagoCheckoutModal } from "../../context/MercadoPagoCheckoutModalContext";
import { PayPalBrandRow } from "./PayPalBrandRow";
import { MercadoPagoBrandRow } from "./MercadoPagoBrandRow";

type Props = {
  plan: Plan;
  isDark?: boolean;
};

/**
 * Checkout con ambas monedas a la vez: Mercado Pago cobra el precio COP y
 * PayPal el precio USD — la visitante elige, sin gating por región.
 */
const DualCurrencyCheckout = ({ plan, isDark = true }: Props) => {
  const { openPayPal } = usePayPalModal();
  const { openMercadoPago } = useMercadoPagoCheckoutModal();
  // "Mounted" sin setState-en-efecto: evita el mismatch de hidratación.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const pulse = isDark ? "bg-white/10" : "bg-black/[0.06]";

  if (!ready) {
    return (
      <div className="mt-6 flex min-h-[150px] flex-col gap-2" aria-busy="true">
        <div className={`h-12 animate-pulse rounded-full ${pulse}`} />
        <div className={`h-12 animate-pulse rounded-full ${pulse}`} />
        <div className={`mx-auto h-3 w-36 animate-pulse rounded-full ${pulse}`} />
      </div>
    );
  }

  const mpClass = isDark
    ? "border-white/15 bg-white shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#00bcff] hover:bg-[#f4fbff]"
    : "border-[#b8e6f8] bg-gradient-to-b from-white via-[#f6fcff] to-[#e6f4fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(10,0,128,0.08)] hover:border-[#00bcff] hover:shadow-[0_10px_28px_rgba(10,0,128,0.12)]";

  const paypalClass = isDark
    ? "border-white/15 bg-white text-[#003087] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#009cde] hover:bg-[#f4f9ff]"
    : "border-[#b8daf3] bg-gradient-to-b from-white via-[#f8fbff] to-[#e9f4fc] text-[#003087] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(0,48,135,0.08)] hover:border-[#009cde] hover:shadow-[0_10px_28px_rgba(0,48,135,0.12)]";

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {plan.amountCop != null && (
        <button
          type="button"
          onClick={() => openMercadoPago(plan.id)}
          className={`group flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2.5 transition-all cursor-pointer ${mpClass}`}
        >
          <div className="flex flex-col items-center">
            <MercadoPagoBrandRow
              tone="onLight"
              logoHeight={35}
              className="items-center"
            />
            <span className="text-[10px] font-[font1] text-black/50 -mt-0.5">
              {formatCop(plan.amountCop)} COP
            </span>
          </div>
        </button>
      )}

      <button
        type="button"
        onClick={() => openPayPal(plan.id)}
        className={`group flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2.5 transition-all cursor-pointer ${paypalClass}`}
      >
        <div className="flex flex-col items-center">
          <PayPalBrandRow
            tone="onLight"
            subtitle="Saldo o tarjeta"
            className="items-center"
          />
          <span className="text-[10px] font-[font1] text-black/50 -mt-0.5">
            {formatUsd(plan.amountUsd)} USD
          </span>
        </div>
      </button>

      <a
        href={buildWhatsAppUrl(plan.whatsappMessage)}
        target="_blank"
        rel="noopener noreferrer"
        className={`w-full text-center font-[font1] text-[11px] uppercase tracking-[0.3em] py-1 transition-colors ${
          isDark
            ? "text-white/60 hover:text-linen"
            : "text-black/60 hover:text-black"
        }`}
      >
        Prefiero WhatsApp
      </a>
    </div>
  );
};

export default DualCurrencyCheckout;
