"use client";

import { useEffect, useState } from "react";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import { formatUsd, type PlanId } from "../../../lib/plans";
import { useCheckoutPlan } from "./useCheckoutPlan";
import { useCookieConsent } from "../../context/CookieConsentContext";
import CheckoutPaymentModalFrame from "./CheckoutPaymentModalFrame";

type Props = {
  planId: PlanId | null;
  onClose: () => void;
};

type Quote = {
  subtotal?: string;
  fee?: string;
  total?: string;
  currency?: string;
  discountMinor?: number;
  promoCode?: string;
  promoCodeError?: string;
};

type UiState =
  | { kind: "ready" }
  | { kind: "redirecting" }
  | { kind: "error"; message: string };

/**
 * Confirmación de precio antes de salir a Lemon Squeezy. Sin campos: LS recoge
 * email, nombre y dirección de facturación por obligación fiscal, y el webhook
 * completa el contacto con eso. El WhatsApp se pide después en /pago/exito.
 *
 * Existe sólo para desglosar la comisión: el plan se anuncia en NETO y el cobro
 * lleva la comisión encima, así que sin este paso la clienta vería $80 en la
 * web y $84.74 en el checkout.
 */
const LemonSqueezyCheckoutModal = ({ planId, onClose }: Props) => {
  const open = planId !== null;
  const { plan, loading: planLoading } = useCheckoutPlan(open ? planId : null);
  const { marketingEnabled } = useCookieConsent();

  const [ui, setUi] = useState<UiState>({ kind: "ready" });
  const [quote, setQuote] = useState<Quote | null>(null);
  // `promoDraft` es lo que se teclea; `promo` es lo enviado a cotizar. Separados
  // para no pedir una cotización por cada pulsación.
  const [promoDraft, setPromoDraft] = useState("");
  const [promo, setPromo] = useState<string | undefined>(undefined);

  // El precio del plan es el NETO; el cliente paga el bruto con la comisión de
  // Lemon Squeezy encima. Sin desglosar aquí, la visitante ve $80 en la web y
  // $84.74 en el checkout — que es exactamente la sorpresa que hay que evitar.
  useEffect(() => {
    if (!open || !planId) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/payments/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId,
            provider: "lemonsqueezy",
            promoCode: promo,
          }),
        });
        const data = (await res.json()) as Quote;
        if (!cancelled && res.ok) setQuote(data);
      } catch {
        // Sin cotización se muestra sólo el precio del plan; no bloquea el pago.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, planId, promo]);

  const go = async (body: Record<string, unknown>) => {
    setUi({ kind: "redirecting" });
    try {
      const res = await fetch("/api/checkout/lemonsqueezy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          consentAdTracking: marketingEnabled,
          ...body,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setUi({
          kind: "error",
          message:
            data.error === "lemonsqueezy_disabled"
              ? "Este medio de pago no está disponible por ahora."
              : "No se pudo abrir el pago. Intenta de nuevo o escríbenos por WhatsApp.",
        });
        return;
      }
      window.location.href = data.url;
    } catch {
      setUi({ kind: "error", message: "Error de red. Intenta de nuevo." });
    }
  };

  useEffect(() => {
    if (!open) {
      setUi({ kind: "ready" });
      setPromoDraft("");
      setPromo(undefined);
    }
  }, [open]);

  if (!open || planLoading || !plan) return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <CheckoutPaymentModalFrame
      ariaLabel="Pagar con tarjeta o PayPal"
      gradientBackground="linear-gradient(160deg,#141118 0%,#1c1622 55%,#241b2b 100%)"
      onClose={onClose}
      onBackdropClick={backdropClick}
      header={
        <div>
          <div className="font-[font2] uppercase text-xs tracking-[0.35em] text-linen/70">
            {plan.title}
          </div>
          {quote?.total ? (
            <>
              <div className="font-[font1] text-2xl mt-2 text-linen">
                {quote.total} USD
              </div>
              <div className="font-[font1] text-sm text-white/50 mt-1 space-y-0.5">
                <div className="flex justify-between gap-6">
                  <span>Subtotal</span>
                  <span>{quote.subtotal} USD</span>
                </div>
                {quote.discountMinor ? (
                  <div className="flex justify-between gap-6 text-emerald-300/80">
                    <span>Descuento {quote.promoCode}</span>
                    <span>-{(quote.discountMinor / 100).toFixed(2)} USD</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-6">
                  <span>Comisión de procesamiento</span>
                  <span>{quote.fee} USD</span>
                </div>
              </div>
            </>
          ) : (
            <div className="font-[font1] text-2xl mt-2 text-linen">
              {formatUsd(plan.amountUsd)} USD
            </div>
          )}
          <div className="font-[font1] text-xs text-white/40 mt-2">
            Tarjeta, PayPal, Apple Pay o Google Pay
          </div>
        </div>
      }
    >
      {ui.kind !== "error" && (
        <div className="mb-3">
          <label
            htmlFor="ls-promo"
            className="font-[font1] text-[11px] uppercase tracking-[0.2em] text-white/50"
          >
            Código promocional (opcional)
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="ls-promo"
              value={promoDraft}
              onChange={(e) => setPromoDraft(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPromo(promoDraft.trim() || undefined);
                }
              }}
              placeholder="EJ. VERANO2026"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-[font1] text-sm text-linen placeholder:text-white/30"
            />
            <button
              type="button"
              onClick={() => setPromo(promoDraft.trim() || undefined)}
              className="shrink-0 rounded-lg border border-white/20 px-3 py-2 font-[font1] text-[11px] uppercase tracking-[0.2em] text-white/70 hover:text-linen"
            >
              Aplicar
            </button>
          </div>
          {quote?.promoCodeError && (
            <p
              role="alert"
              className="mt-1.5 font-[font1] text-[11px] text-red-300/80"
            >
              Ese código no es válido para este plan.
            </p>
          )}
        </div>
      )}

      {ui.kind !== "error" && (
        <button
          type="button"
          disabled={ui.kind === "redirecting"}
          onClick={() => void go(promo ? { promoCode: promo } : {})}
          className="w-full rounded-full bg-linen px-4 py-3 font-[font1] text-[12px] uppercase tracking-[0.25em] text-[#141118] transition-opacity disabled:opacity-60"
        >
          {ui.kind === "redirecting"
            ? "Abriendo el pago seguro…"
            : "Continuar al pago"}
        </button>
      )}

      {ui.kind === "error" && (
        <div className="py-4">
          <p role="alert" className="font-[font1] text-white/80 text-sm">
            {ui.message}
          </p>
          <a
            href={buildWhatsAppUrl(plan.whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block font-[font1] text-[11px] uppercase tracking-[0.3em] text-white/60 hover:text-linen"
          >
            Escribir por WhatsApp ({WHATSAPP_NUMBER})
          </a>
        </div>
      )}
    </CheckoutPaymentModalFrame>
  );
};

export default LemonSqueezyCheckoutModal;
