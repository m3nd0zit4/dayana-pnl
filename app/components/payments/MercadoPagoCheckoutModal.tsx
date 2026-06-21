"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import { formatCop, formatUsd, type PlanId } from "../../../lib/plans";
import { useCheckoutPlan } from "./useCheckoutPlan";
import { MercadoPagoBrandRow } from "./MercadoPagoBrandRow";
import CheckoutContactStep, {
  type CheckoutContactPayload,
} from "./CheckoutContactStep";
import CheckoutPaymentModalFrame, {
  usePaymentModalScrollLock,
} from "./CheckoutPaymentModalFrame";

type MercadoPagoCheckoutModalProps = {
  planId: PlanId | null;
  onClose: () => void;
};

type Breakdown = {
  subtotal: string;
  fee: string;
  total: string;
  currency: string;
  referenceCurrency?: string;
  referenceSubtotal?: string;
  referenceFee?: string;
  referenceTotal?: string;
};

type UiState =
  | { kind: "idle" }
  | { kind: "contact" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "redirecting" }
  | { kind: "error"; message: string };

const formatBreakdown = (value: string, currency: string): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} ${currency}`;
  if (currency === "COP") {
    return `${n.toLocaleString("es-CO", {
      maximumFractionDigits: 0,
    })} ${currency}`;
  }
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
};

const MercadoPagoCheckoutModal = ({
  planId,
  onClose,
}: MercadoPagoCheckoutModalProps) => {
  const open = planId !== null;
  const { plan, loading: planLoading } = useCheckoutPlan(open ? planId : null);

  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [contactPayload, setContactPayload] = useState<CheckoutContactPayload | null>(
    null
  );
  const [checkoutContactId, setCheckoutContactId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setUi({ kind: "idle" });
      setBreakdown(null);
      setContactPayload(null);
      setCheckoutContactId(null);
    } else {
      setUi({ kind: "contact" });
    }
  }, [open]);

  usePaymentModalScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !plan) return;
    const t = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(t);
  }, [open, plan]);

  useEffect(() => {
    if (!open || !plan || !contactPayload) return;
    let cancelled = false;
    setUi({ kind: "loading" });
    void fetch("/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: plan.id, provider: "mercadopago" }),
    })
      .then(async (res) => {
        const data = (await res.json()) as Partial<Breakdown> & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.subtotal || !data.fee || !data.total || !data.currency) {
          setUi({
            kind: "error",
            message:
              "No se pudo calcular el total con la comisión. Revisa la configuración o usa WhatsApp.",
          });
          return;
        }
        setBreakdown({
          subtotal: data.subtotal,
          fee: data.fee,
          total: data.total,
          currency: data.currency,
          referenceCurrency: data.referenceCurrency,
          referenceSubtotal: data.referenceSubtotal,
          referenceFee: data.referenceFee,
          referenceTotal: data.referenceTotal,
        });
        setUi({ kind: "ready" });
      })
      .catch(() => {
        if (!cancelled) {
          setUi({
            kind: "error",
            message: "Error de red. Intenta de nuevo.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, plan, contactPayload]);

  if (!open) return null;
  if (typeof document === "undefined") return null;
  if (planLoading || !plan) return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const goToCheckout = async () => {
    if (!plan || !contactPayload) return;
    setUi({ kind: "redirecting" });
    try {
      const res = await fetch("/api/mercadopago/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          mode: "full",
          contactId: checkoutContactId ?? undefined,
          ...contactPayload,
        }),
      });
      const data = (await res.json()) as {
        init_point?: string;
        error?: string;
      };
      if (!res.ok || !data.init_point) {
        setUi({
          kind: "error",
          message:
            "No se pudo abrir el checkout. Revisa la configuración o escribe por WhatsApp.",
        });
        return;
      }
      window.location.href = data.init_point;
    } catch {
      setUi({
        kind: "error",
        message: "Error de red. Intenta de nuevo.",
      });
    }
  };

  const amountLabel = formatUsd(plan.amountUsd);

  const content = (
    <CheckoutPaymentModalFrame
      ariaLabel={`Pago Mercado Pago — ${plan.title}`}
      gradientBackground="radial-gradient(60% 40% at 0% 0%, rgba(0,158,227,0.18), transparent 60%), radial-gradient(50% 45% at 100% 100%, rgba(236,227,212,0.10), transparent 65%)"
      closeButtonRef={closeButtonRef}
      onClose={onClose}
      onBackdropClick={backdropClick}
      header={
        <MercadoPagoBrandRow
          tone="onDark"
          subtitle="Checkout seguro"
          logoHeight={28}
          className="items-start text-left"
        />
      }
    >
      <div className="relative">
          <div className="rounded-xl border border-linen/12 bg-linen/[0.04] p-4 mb-5">
            <div className="font-[font2] uppercase text-[10px] tracking-[0.35em] text-linen/70">
              {plan.kind === "course" ? "Curso en vivo" : "Terapia PNL"}
            </div>
            <div className="font-[font2] uppercase text-xl mt-1">{plan.title}</div>
            <div className="font-[font1] text-sm text-white/70">{plan.sessions}</div>

            {breakdown ? (
              <div className="mt-3 space-y-1.5 font-[font1] text-sm">
                {breakdown.referenceCurrency === "USD" &&
                breakdown.referenceTotal ? (
                  <>
                    <div className="flex justify-between text-white/55">
                      <span>Precio del plan</span>
                      <span>
                        {formatBreakdown(
                          breakdown.referenceSubtotal ?? breakdown.referenceTotal,
                          "USD"
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between text-white/55">
                      <span>Comisión Mercado Pago</span>
                      <span>
                        +{" "}
                        {formatBreakdown(
                          breakdown.referenceFee ?? "0",
                          "USD"
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between text-white/70">
                      <span>Equivalente USD</span>
                      <span>
                        {formatBreakdown(breakdown.referenceTotal, "USD")}
                      </span>
                    </div>
                    <div className="border-t border-linen/12 my-2" />
                  </>
                ) : null}
                <div className="flex justify-between text-white/70">
                  <span>Subtotal</span>
                  <span>{formatBreakdown(breakdown.subtotal, breakdown.currency)}</span>
                </div>
                <div className="flex justify-between text-white/55">
                  <span>Comisión Mercado Pago</span>
                  <span>+ {formatBreakdown(breakdown.fee, breakdown.currency)}</span>
                </div>
                <div className="border-t border-linen/12 my-2" />
                <div className="flex justify-between items-baseline">
                  <span className="font-[font2] uppercase text-[10px] tracking-[0.3em] text-linen/70">
                    Total en Mercado Pago
                  </span>
                  <span className="font-[font1] text-2xl text-linen">
                    {formatBreakdown(breakdown.total, breakdown.currency)}
                  </span>
                </div>
                {breakdown.currency === "COP" ? (
                  <p className="font-[font1] text-[11px] text-white/45 leading-snug pt-1">
                    Mercado Pago cobra en pesos colombianos (COP). El monto en
                    checkout coincide con este total. Para pagar en dólares usa
                    PayPal.
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="font-[font1] text-2xl mt-2 text-linen">
                  {amountLabel} USD
                </div>
                {plan.amountCop != null ? (
                  <div className="font-[font1] text-sm text-white/50 mt-1">
                    ≈ {formatCop(plan.amountCop)} COP aprox.
                  </div>
                ) : null}
              </>
            )}
          </div>

          {ui.kind === "contact" && (
            <CheckoutContactStep
              submitLabel="Continuar al pago"
              onSubmit={(payload) => {
                setUi({ kind: "loading" });
                void (async () => {
                  try {
                    const res = await fetch("/api/checkout/contact", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ planId: plan.id, ...payload }),
                    });
                    const data = (await res.json()) as {
                      contactId?: string;
                      message?: string;
                    };
                    if (!res.ok || !data.contactId) {
                      throw new Error(
                        data.message ?? "No se pudo registrar tu contacto."
                      );
                    }
                    setCheckoutContactId(data.contactId);
                    setContactPayload(payload);
                  } catch (e) {
                    setUi({
                      kind: "error",
                      message:
                        e instanceof Error
                          ? e.message
                          : "No se pudo registrar tu contacto.",
                    });
                  }
                })();
              }}
            />
          )}

          {ui.kind === "loading" && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-9 h-9 rounded-full border-2 border-linen/20 border-t-linen animate-spin" />
              <p className="font-[font1] text-sm text-white/55 text-center">
                Calculando total con comisión…
              </p>
            </div>
          )}

          {ui.kind === "error" && (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm font-[font1] text-red-200/90 mb-4">
              {ui.message}
            </div>
          )}

          {(ui.kind === "ready" || ui.kind === "redirecting") && (
            <>
              <p className="font-[font1] text-[12px] text-white/55 leading-snug mb-3">
                Vas a ser redirigido a Mercado Pago para completar el pago de
                forma segura. Aceptan tarjeta débito, crédito y PSE
                {breakdown?.currency === "COP" ? " en pesos colombianos" : ""}.
              </p>
              <button
                type="button"
                onClick={() => void goToCheckout()}
                disabled={ui.kind === "redirecting"}
                className="w-full rounded-full bg-[#00a6e8] py-3 font-[font2] uppercase tracking-[0.18em] text-[11px] text-white hover:bg-[#0098d2] transition-colors cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
              >
                {ui.kind === "redirecting"
                  ? "Abriendo Mercado Pago…"
                  : "Continuar a Mercado Pago"}
              </button>
            </>
          )}

          {ui.kind === "error" && (
            <div className="flex flex-col gap-2 mt-1">
              <a
                href={buildWhatsAppUrl(
                  `Hola Dayana, intenté pagar con Mercado Pago el plan "${plan.title} — ${plan.sessions}" pero tuve un error. ¿Podemos coordinar?`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.25em] py-3 hover:bg-white transition-colors text-center"
              >
                Escribir por WhatsApp
              </a>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-full border border-linen/30 py-3 font-[font2] uppercase text-xs tracking-[0.2em] text-white/80 hover:bg-linen/5 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}

          <p className="mt-4 font-[font1] text-[11px] text-white/35 text-center">
            ¿Prefieres otra forma? Escríbenos al {WHATSAPP_NUMBER}
          </p>
      </div>
    </CheckoutPaymentModalFrame>
  );

  return createPortal(content, document.body);
};

export default MercadoPagoCheckoutModal;
