"use client";

import { useEffect, useState } from "react";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import { formatCop, formatUsd, type PlanId } from "../../../lib/plans";
import { useCheckoutPlan } from "./useCheckoutPlan";
import CheckoutPaymentModalFrame from "./CheckoutPaymentModalFrame";
import { PayPalWordmark } from "./PayPalBrandRow";
import {
  startCheckout,
  type CheckoutProvider,
  type PayPalFunding,
} from "./startCheckout";

type Props = {
  planId: PlanId | null;
  provider: CheckoutProvider;
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
  /** Hay al menos un código vivo aplicable a este plan. */
  promoAvailable?: boolean;
};

/** Tarjeta genérica: dice "esto es pagar con plástico" sin marca de red. */
const CardGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
    aria-hidden="true"
  >
    <rect x="2" y="5" width="20" height="14" rx="2.5" />
    <path d="M2 10h20" />
    <path d="M6 15h3" />
  </svg>
);

type UiState =
  | { kind: "ready" }
  | { kind: "redirecting" }
  | { kind: "error"; message: string };

const PROVIDER_LABEL: Record<CheckoutProvider, string> = {
  paypal: "Tarjeta de crédito o débito · pago seguro",
  mercadopago: "PSE, Nequi, tarjeta o efectivo",
};

/**
 * Confirmación de precio antes de salir al proveedor. Sin campos de datos:
 * PayPal y Mercado Pago ya exigen email para pagar y lo devuelven en la
 * captura o el webhook, así que pedirlo antes sólo restaba conversión. El
 * WhatsApp se pide después en /pago/exito.
 *
 * Existe por dos razones: desglosar la comisión (los planes se anuncian en
 * NETO y el cobro la lleva encima) y aceptar el código promocional, que se
 * valida contra el CRM y no contra el proveedor.
 */
const CheckoutConfirmModal = ({ planId, provider, onClose }: Props) => {
  const open = planId !== null;
  const { plan, loading: planLoading } = useCheckoutPlan(open ? planId : null);

  const [ui, setUi] = useState<UiState>({ kind: "ready" });
  const [quote, setQuote] = useState<Quote | null>(null);
  // `promoDraft` es lo tecleado; `promo` lo enviado a cotizar. Separados para
  // no pedir una cotización por cada pulsación.
  const [promoDraft, setPromoDraft] = useState("");
  const [promo, setPromo] = useState<string | undefined>(undefined);

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
          body: JSON.stringify({ planId, provider, promoCode: promo }),
        });
        const data = (await res.json()) as Quote;
        if (!cancelled && res.ok) setQuote(data);
      } catch {
        // Sin cotización se muestra el precio del plan; no bloquea el pago.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, planId, provider, promo]);

  useEffect(() => {
    if (!open) {
      setUi({ kind: "ready" });
      setPromoDraft("");
      setPromo(undefined);
    }
  }, [open]);

  if (!open || planLoading || !plan) return null;

  const isCop = quote?.currency === "COP";
  const money = (v?: string) => {
    if (!v) return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    return isCop
      ? `${n.toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`
      : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  };

  /**
   * La mensualidad se cobra sola: en PayPal se da de alta como suscripción
   * recurrente en vez de como cobro suelto. Mercado Pago sigue con el cobro
   * puntual hasta que su `preapproval` esté verificado para esta cuenta.
   */
  const isMembership = plan.kind === "course";
  /**
   * En PayPal la mensualidad ES la suscripción. En Mercado Pago conviven las
   * dos: su cobro recurrente sólo admite tarjeta, y quitar el pago suelto
   * dejaría fuera a quien paga por PSE, Nequi o efectivo — que en Colombia es
   * mucha gente.
   */
  const subscribes = isMembership && provider === "paypal";
  const offersBoth = isMembership && provider === "mercadopago";

  /** Alta recurrente en Mercado Pago, donde convive con el pago suelto. */
  const goSubscribe = async () => {
    setUi({ kind: "redirecting" });
    const failure = await startCheckout(provider, plan.id, { subscribe: true });
    if (failure) setUi({ kind: "error", message: failure });
  };

  const go = async (funding?: PayPalFunding) => {
    /**
     * Código escrito pero sin pulsar "Aplicar".
     *
     * Antes se mandaba `promo` —lo YA aplicado— así que quien tecleaba el cupón
     * y le daba directo a pagar acababa pagando el precio entero con el código
     * a la vista en el campo. Silencioso y caro. Ahora se cotiza primero con lo
     * escrito: si vale, se aplica y se cobra con descuento; si no, se avisa y
     * no se sale de la pantalla.
     */
    const draft = promoDraft.trim();
    let code = promo;

    if (draft && draft !== promo) {
      setUi({ kind: "redirecting" });
      try {
        const res = await fetch("/api/payments/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, provider, promoCode: draft }),
        });
        const data = (await res.json()) as Quote;
        if (res.ok && !data.promoCodeError) {
          setQuote(data);
          setPromo(draft);
          code = draft;
        } else {
          // Inválido: se muestra el error junto al campo, sin tapar el modal,
          // para que pueda corregirlo o seguir sin él.
          setQuote((q) => (q ? { ...q, promoCodeError: "invalid" } : q));
          setUi({ kind: "ready" });
          return;
        }
      } catch {
        setUi({ kind: "error", message: "Error de red. Intenta de nuevo." });
        return;
      }
    }

    setUi({ kind: "redirecting" });
    const failure = await startCheckout(provider, plan.id, {
      promoCode: code,
      funding,
      subscribe: subscribes,
    });
    if (failure) setUi({ kind: "error", message: failure });
  };

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <CheckoutPaymentModalFrame
      ariaLabel={`Pagar con ${provider === "paypal" ? "PayPal" : "Mercado Pago"}`}
      gradientBackground="linear-gradient(160deg,#ffffff 0%,#fdfbf8 55%,#f7f3ee 100%)"
      onClose={onClose}
      onBackdropClick={backdropClick}
      header={
        <div>
          <div className="font-[font2] uppercase text-xs tracking-[0.35em] text-black/55">
            {plan.title}
          </div>
          {quote?.total ? (
            <>
              <div className="font-[font1] text-2xl mt-2 text-[#141118]">
                {money(quote.total)}
              </div>
              <div className="font-[font1] text-sm text-black/55 mt-1 space-y-0.5">
                <div className="flex justify-between gap-6">
                  <span>Subtotal</span>
                  <span>{money(quote.subtotal)}</span>
                </div>
                {quote.discountMinor ? (
                  <div className="flex justify-between gap-6 text-emerald-700">
                    <span>Descuento {quote.promoCode}</span>
                    <span>
                      -
                      {isCop
                        ? `${quote.discountMinor.toLocaleString("es-CO")} COP`
                        : `${(quote.discountMinor / 100).toFixed(2)} USD`}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-6">
                  <span>Comisión de procesamiento</span>
                  <span>{money(quote.fee)}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="font-[font1] text-2xl mt-2 text-[#141118]">
              {provider === "mercadopago" && plan.amountCop != null
                ? `${formatCop(plan.amountCop)} COP`
                : `${formatUsd(plan.amountUsd)} USD`}
            </div>
          )}
          <div className="font-[font1] text-xs text-black/45 mt-2">
            {PROVIDER_LABEL[provider]}
          </div>
        </div>
      }
    >
      {ui.kind !== "error" && (
        <>
          {/*
            El campo sólo aparece si existe un código aplicable. Un hueco que
            nunca acepta nada hace dudar de que el precio sea el correcto y
            manda a buscar cupones fuera en vez de terminar la compra.
          */}
          {quote?.promoAvailable !== false && !subscribes && (
          <div className="mb-3">
            <label
              htmlFor="chk-promo"
              className="font-[font1] text-[11px] uppercase tracking-[0.2em] text-black/50"
            >
              Código promocional (opcional)
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="chk-promo"
                value={promoDraft}
                onChange={(e) => setPromoDraft(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setPromo(promoDraft.trim() || undefined);
                  }
                }}
                placeholder="EJ. VERANO2026"
                className="min-w-0 flex-1 rounded-lg border border-black/15 bg-black/[0.03] px-3 py-2 font-[font1] text-sm text-[#141118] placeholder:text-black/30"
              />
              <button
                type="button"
                onClick={() => setPromo(promoDraft.trim() || undefined)}
                className="shrink-0 cursor-pointer rounded-lg border border-black/20 px-3 py-2 font-[font1] text-[11px] uppercase tracking-[0.2em] text-black/70 transition-colors hover:border-black/40 hover:bg-black/[0.04] hover:text-black"
              >
                Aplicar
              </button>
            </div>
            {quote?.promoCodeError && (
              <p
                role="alert"
                className="mt-1.5 font-[font1] text-[11px] text-red-600"
              >
                Ese código no es válido para este plan.
              </p>
            )}
          </div>
          )}

          {/*
            Dos caminos explícitos en PayPal.

            La tarjeta va PRIMERO y como acción principal: la mayoría de las
            compradoras internacionales no tiene cuenta de PayPal, y mandarlas
            a la pantalla de acceso —lo que hacía el botón único— era donde se
            perdía la venta. Mercado Pago no se parte: su checkout ya ofrece
            todos los medios en una sola pantalla.
          */}
          {subscribes ? (
            <div className="space-y-2.5">
              {/*
                También en la mensualidad la tarjeta va primero: PayPal ofrece
                "añadir tarjeta" dentro de su flujo, así que quien no tiene
                cuenta puede domiciliar igual.
              */}
              <button
                type="button"
                disabled={ui.kind === "redirecting"}
                onClick={() => void go("card")}
                className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-[#141118] px-4 py-3.5 font-[font2] text-[12px] uppercase tracking-[0.28em] text-linen shadow-[0_8px_20px_rgba(20,17,24,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_14px_28px_rgba(20,17,24,0.26)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141118] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <CardGlyph />
                {ui.kind === "redirecting"
                  ? "Abriendo el pago seguro…"
                  : "Suscribirme con tarjeta"}
              </button>

              <button
                type="button"
                disabled={ui.kind === "redirecting"}
                onClick={() => void go("wallet")}
                aria-label="Suscribirme con mi cuenta de PayPal"
                className="flex w-full cursor-pointer items-center justify-center rounded-full border border-[#b8daf3] bg-gradient-to-b from-white via-[#f8fbff] to-[#e9f4fc] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#009cde] hover:shadow-[0_12px_26px_rgba(0,48,135,0.16)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#009cde] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <PayPalWordmark tone="onLight" className="text-[19px]" />
              </button>

              <p className="pt-0.5 text-center font-[font1] text-[10px] leading-relaxed text-black/45">
                Se cobra cada mes automáticamente. Puedes cancelar cuando
                quieras desde tu cuenta y conservas el acceso hasta el final del
                mes ya pagado.
              </p>
            </div>
          ) : provider === "paypal" ? (
            <div className="space-y-2.5">
              {/*
                Tarjeta primero, con los sellos de marca a la vista: la mayoría
                de las compradoras internacionales no tiene cuenta de PayPal y
                el botón anterior las mandaba al acceso, que es donde se perdía
                la venta.
              */}
              <button
                type="button"
                disabled={ui.kind === "redirecting"}
                onClick={() => void go("card")}
                className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-[#141118] px-4 py-3.5 font-[font2] text-[12px] uppercase tracking-[0.28em] text-linen shadow-[0_8px_20px_rgba(20,17,24,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_14px_28px_rgba(20,17,24,0.26)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141118] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <CardGlyph />
                {ui.kind === "redirecting"
                  ? "Abriendo el pago seguro…"
                  : "Pagar con tarjeta"}
              </button>

              <button
                type="button"
                disabled={ui.kind === "redirecting"}
                onClick={() => void go("wallet")}
                aria-label="Pagar con mi cuenta de PayPal"
                className="flex w-full cursor-pointer items-center justify-center rounded-full border border-[#b8daf3] bg-gradient-to-b from-white via-[#f8fbff] to-[#e9f4fc] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#009cde] hover:shadow-[0_12px_26px_rgba(0,48,135,0.16)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#009cde] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <PayPalWordmark tone="onLight" className="text-[19px]" />
              </button>

              <p className="pt-0.5 text-center font-[font1] text-[10px] text-black/45">
                No necesitas cuenta de PayPal para pagar con tarjeta.
              </p>
            </div>
          ) : offersBoth ? (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={ui.kind === "redirecting"}
                onClick={() => void goSubscribe()}
                className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-[#141118] px-4 py-3.5 font-[font2] text-[12px] uppercase tracking-[0.28em] text-linen shadow-[0_8px_20px_rgba(20,17,24,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_14px_28px_rgba(20,17,24,0.26)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141118] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <CardGlyph />
                {ui.kind === "redirecting"
                  ? "Abriendo el pago seguro…"
                  : "Suscribirme con tarjeta"}
              </button>

              <button
                type="button"
                disabled={ui.kind === "redirecting"}
                onClick={() => void go()}
                className="w-full cursor-pointer rounded-full border border-black/20 px-4 py-3 font-[font2] text-[12px] uppercase tracking-[0.28em] text-black/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-black/40 hover:bg-black/[0.03] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141118] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                Pagar un mes
              </button>

              <p className="pt-0.5 text-center font-[font1] text-[10px] leading-relaxed text-black/45">
                La suscripción se cobra sola cada mes y sólo admite tarjeta.
                Pagando un mes puedes usar PSE, Nequi o efectivo.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={ui.kind === "redirecting"}
              onClick={() => void go()}
              className="w-full cursor-pointer rounded-full bg-[#141118] px-4 py-3.5 font-[font2] text-[12px] uppercase tracking-[0.28em] text-linen shadow-[0_8px_20px_rgba(20,17,24,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_14px_28px_rgba(20,17,24,0.26)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141118] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {ui.kind === "redirecting" ? "Abriendo el pago seguro…" : "Pagar"}
            </button>
          )}
        </>
      )}

      {ui.kind === "error" && (
        <div className="py-4">
          <p role="alert" className="font-[font1] text-black/80 text-sm">
            {ui.message}
          </p>
          <a
            href={buildWhatsAppUrl(plan.whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block font-[font1] text-[11px] uppercase tracking-[0.3em] text-black/60 hover:text-black"
          >
            Escribir por WhatsApp ({WHATSAPP_NUMBER})
          </a>
        </div>
      )}
    </CheckoutPaymentModalFrame>
  );
};

export default CheckoutConfirmModal;
