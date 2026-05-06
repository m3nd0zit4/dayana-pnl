"use client";

import { useEffect, useState } from "react";
import { buildWhatsAppUrl } from "../../../lib/contact";
import type { Plan } from "../../../lib/plans";
import { usePayPalModal } from "../../context/PayPalModalContext";
import { useMercadoPagoCheckoutModal } from "../../context/MercadoPagoCheckoutModalContext";
import { PayPalBrandRow } from "./PayPalBrandRow";
import { MercadoPagoBrandRow } from "./MercadoPagoBrandRow";

type Props = {
  plan: Plan;
  isDark: boolean;
};

const PlanCheckoutButtons = ({ plan, isDark }: Props) => {
  const { openPayPal } = usePayPalModal();
  const { openMercadoPago } = useMercadoPagoCheckoutModal();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const pulse = isDark ? "bg-white/10" : "bg-black/[0.06]";
  const payBusy = false;

  if (!ready) {
    return (
      <div className="mt-6 flex min-h-[130px] flex-col gap-2" aria-busy="true">
        <div className={`h-11 animate-pulse rounded-full ${pulse}`} />
        <div className={`h-11 animate-pulse rounded-full ${pulse}`} />
        <div className={`mx-auto h-3 w-36 animate-pulse rounded-full ${pulse}`} />
      </div>
    );
  }

  const mpFullClass = isDark
    ? "border-white/15 bg-white shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#00bcff] hover:bg-[#f4fbff]"
    : "border-[#b8e6f8] bg-gradient-to-b from-white via-[#f6fcff] to-[#e6f4fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(10,0,128,0.08)] hover:border-[#00bcff] hover:shadow-[0_10px_28px_rgba(10,0,128,0.12)]";

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      <button
        type="button"
        disabled={payBusy}
        onClick={() => openPayPal(plan.id)}
        className={`group flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2.5 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none ${
          isDark
            ? "border-white/15 bg-white text-[#003087] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#009cde] hover:bg-[#f4f9ff]"
            : "border-[#b8daf3] bg-gradient-to-b from-white via-[#f8fbff] to-[#e9f4fc] text-[#003087] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(0,48,135,0.08)] hover:border-[#009cde] hover:shadow-[0_10px_28px_rgba(0,48,135,0.12)]"
        }`}
      >
        <PayPalBrandRow
          tone="onLight"
          subtitle="Saldo o tarjeta"
          className="items-center"
        />
      </button>
      <button
        type="button"
        disabled={payBusy}
        onClick={() => openMercadoPago(plan.id)}
        className={`group flex w-full items-center justify-center gap-1 rounded-full border px-3 py-2.5 transition-all cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${mpFullClass}`}
      >
        <MercadoPagoBrandRow
          tone="onLight"
          logoHeight={35}
          className="items-center"
        />
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

export default PlanCheckoutButtons;
