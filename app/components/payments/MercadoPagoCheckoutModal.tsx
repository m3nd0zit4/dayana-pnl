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
  discountMinor?: number;
  promoCode?: string;
  promoCodeError?: string;
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
  const {
    plan,
    loading: planLoading,
    error: planError,
  } = useCheckoutPlan(open ? planId : null);

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
      body: JSON.stringify({
        planId: plan.id,
        provider: "mercadopago",
        promoCode: contactPayload.promoCode,
      }),
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
          discountMinor: data.discountMinor,
          promoCode: data.promoCode,
          promoCodeError: data.promoCodeError,
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

  if (planError) {
    return createPortal(
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-sm rounded-2xl border border-linen/20 bg-black p-6 text-center">
          <p className="font-[font1] text-sm leading-relaxed text-white/80">
            No pudimos cargar el plan en este momento. Intenta de nuevo en unos
            segundos o escríbenos por WhatsApp.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 rounded-full border border-linen/30 px-6 py-2.5 font-[font2] uppercase text-xs tracking-[0.25em] text-white/80 hover:bg-linen/5"
          >
            Cerrar
          </button>
        </div>
      </div>,
      document.body
    );
  }

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
                {/* COP primary: big total first */}
                <div className="flex justify-between items-baseline">
                  <span className="font-[font2] uppercase text-[10px] tracking-[0.3em] text-linen/70">
                    Total a pagar
                  </span>
                  <span className="font-[font1] text-2xl text-linen">
                    {formatBreakdown(breakdown.total, breakdown.currency)}
                  </span>
                </div>
                <div className="border-t border-linen/12 my-2" />
                {/* breakdown detail */}
                <div className="flex justify-between text-white/55">
                  <span>Subtotal</span>
                  <span>{formatBreakdown(breakdown.subtotal, breakdown.currency)}</span>
                </div>
                <div className="flex justify-between text-white/55">
                  <span>Comisión Mercado Pago</span>
                  <span>+ {formatBreakdown(breakdown.fee, breakdown.currency)}</span>
                </div>
                {breakdown.promoCode && breakdown.discountMinor ? (
                  <div className="flex justify-between text-emerald-300/90">
                    <span>Código {breakdown.promoCode}</span>
                    <span>
                      − {formatBreakdown(String(breakdown.discountMinor), breakdown.currency)}
                    </span>
                  </div>
                ) : null}
                {breakdown.promoCodeError ? (
                  <div className="text-[11px] text-amber-300/80 pt-1">
                    Código promocional no válido — se cobra el precio normal.
                  </div>
                ) : null}
                {/* USD reference (small, muted) */}
                {breakdown.referenceCurrency === "USD" && breakdown.referenceTotal ? (
                  <div className="flex justify-between text-white/40 text-[11px] pt-1">
                    <span>Referencia USD</span>
                    <span>≈ {formatBreakdown(breakdown.referenceTotal, "USD")}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              /* Before breakdown loads: COP primary */
              <>
                <div className="font-[font1] text-2xl mt-2 text-linen">
                  {plan.amountCop != null
                    ? `${formatCop(plan.amountCop)} COP`
                    : `${amountLabel} USD`}
                </div>
                {plan.amountCop != null ? (
                  <div className="font-[font1] text-sm text-white/50 mt-0.5">
                    ≈ {amountLabel} USD
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
