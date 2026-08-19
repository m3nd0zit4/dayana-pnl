"use client";

import { useSyncExternalStore } from "react";
import { buildWhatsAppUrl } from "../../../lib/contact";
import { type Plan } from "../../../lib/plans";
import { isPlanVisibleForRegion } from "../../../lib/pricing/plan-visibility";
import { useCheckoutModal } from "../../context/CheckoutModalContext";
import StripeCheckoutButton from "./StripeCheckoutButton";

type Props = {
  plan: Plan;
  isDark: boolean;
  userCountry?: string | null;
  /** Workshops are payment-only — no WhatsApp escape hatch. */
  showWhatsApp?: boolean;
  /** Intercept the click (e.g. auth gate) instead of opening the checkout. */
  onPay?: (provider: "paypal" | "mercadopago") => void;
};

/**
 * Colombia paga con Mercado Pago (COP, PSE/Nequi/efectivo); el resto del mundo
 * con PayPal (USD).
 *
 * Se intentó mover el cobro internacional a un merchant of record (Lemon
 * Squeezy) para que asumiera impuestos y disputas, y lo rechazaron: el catálogo
 * son sesiones 1:1 entregadas por una persona, y esa categoría está prohibida
 * en todos ellos (Lemon Squeezy, Paddle, FastSpring). PayPal sí admite
 * servicios, y por eso vuelve a ser la vía internacional.
 */
const PlanCheckoutButtons = ({
  plan,
  isDark,
  userCountry,
  showWhatsApp = true,
  onPay,
}: Props) => {
  const { openCheckout } = useCheckoutModal();
  // "Mounted" sin setState-en-efecto: evita el mismatch de hidratación.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isColombia = userCountry === "CO";
  const pulse = isDark ? "bg-white/10" : "bg-black/[0.06]";
  const payBusy = false;
  const stripeEnabled =
    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED === "true";

  // Defense-in-depth: callers should already filter out plans without a
  // real price for the visitor's region, but never render a pay button
  // that would only fail at checkout with no_cop_price.
  if (!isPlanVisibleForRegion(plan, isColombia)) {
    return null;
  }

  if (!ready) {
    return (
      <div className="mt-6 flex min-h-[100px] flex-col gap-2" aria-busy="true">
        <div className={`h-11 animate-pulse rounded-full ${pulse}`} />
        <div
          className={`mx-auto h-3 w-36 animate-pulse rounded-full ${pulse}`}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {/*
        Un único botón "Pagar", igual en los dos proveedores.

        Antes la tarjeta del plan enseñaba la marca del proveedor. Eso adelanta
        una decisión que todavía no toca —y en PayPal ahuyentaba a quien no
        tiene cuenta, creyendo que le hacía falta—. La marca aparece dentro del
        modal, que es donde de verdad se elige cómo pagar.
      */}
      <button
        type="button"
        disabled={payBusy}
        onClick={() => {
          const provider = isColombia ? "mercadopago" : "paypal";
          return onPay ? onPay(provider) : openCheckout(plan.id, provider);
        }}
        className={`group flex w-full cursor-pointer items-center justify-center rounded-full border px-3 py-3 font-[font2] text-[13px] uppercase tracking-[0.3em] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${
          isDark
            ? "border-white/15 bg-linen text-[#141118] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:bg-white hover:shadow-[0_14px_34px_rgba(0,0,0,0.45)] focus-visible:ring-linen focus-visible:ring-offset-[#141118]"
            : "border-black/10 bg-[#141118] text-linen shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:bg-black hover:shadow-[0_14px_30px_rgba(0,0,0,0.2)] focus-visible:ring-[#141118] focus-visible:ring-offset-white"
        }`}
      >
        Pagar
      </button>
      {stripeEnabled && (
        <StripeCheckoutButton planId={plan.id} isDark={isDark} />
      )}
      {showWhatsApp && (
        <a
          href={buildWhatsAppUrl(plan.whatsappMessage)}
          target="_blank"
          rel="noopener noreferrer"
          className={`w-full cursor-pointer text-center font-[font1] text-[11px] uppercase tracking-[0.3em] py-1 transition-colors ${
            isDark
              ? "text-white/60 hover:text-linen"
              : "text-black/60 hover:text-black"
          }`}
        >
          Prefiero WhatsApp
        </a>
      )}
    </div>
  );
};

export default PlanCheckoutButtons;
