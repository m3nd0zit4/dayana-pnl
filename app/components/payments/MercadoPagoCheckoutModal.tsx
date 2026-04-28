"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import { formatUsd, getPlan, type PlanId } from "../../../lib/plans";
import { MercadoPagoBrandRow } from "./MercadoPagoBrandRow";

type MercadoPagoCheckoutModalProps = {
  planId: PlanId | null;
  onClose: () => void;
};

type Breakdown = {
  subtotal: string;
  fee: string;
  total: string;
  currency: string;
};

type UiState =
  | { kind: "idle" }
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
  const plan = planId ? getPlan(planId) : null;

  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setUi({ kind: "idle" });
      setBreakdown(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

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
    if (!open || !plan) return;
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
  }, [open, plan]);

  if (!open || !plan) return null;
  if (typeof document === "undefined") return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const goToCheckout = async () => {
    if (!plan) return;
    setUi({ kind: "redirecting" });
    try {
      const res = await fetch("/api/mercadopago/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, mode: "full" }),
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
    <div
      aria-modal="true"
      role="dialog"
      aria-label={`Pago Mercado Pago — ${plan.title}`}
      className="fixed inset-0 z-[101] flex items-center justify-center p-4 lg:p-6 bg-black/80 backdrop-blur-md animate-[fadeIn_200ms_ease-out]"
      onMouseDown={backdropClick}
    >
      <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-ink text-white border border-linen/15 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] animate-[popIn_240ms_cubic-bezier(0.22,1,0.36,1)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none rounded-2xl opacity-80"
          style={{
            background:
              "radial-gradient(60% 40% at 0% 0%, rgba(0,158,227,0.18), transparent 60%), radial-gradient(50% 45% at 100% 100%, rgba(236,227,212,0.10), transparent 65%)",
          }}
        />

        <div className="relative flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-linen/10">
          <MercadoPagoBrandRow
            tone="onDark"
            subtitle="Checkout seguro"
            logoHeight={28}
            className="items-start text-left"
          />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Cerrar"
            className="flex items-center justify-center w-8 h-8 rounded-full text-white/60 hover:text-linen hover:bg-linen/10 transition-colors cursor-pointer"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative px-6 pt-5 pb-6">
          <div className="rounded-xl border border-linen/12 bg-linen/[0.04] p-4 mb-5">
            <div className="font-[font2] uppercase text-[10px] tracking-[0.35em] text-linen/70">
              {plan.kind === "course" ? "Curso en vivo" : "Terapia PNL"}
            </div>
            <div className="font-[font2] uppercase text-xl mt-1">{plan.title}</div>
            <div className="font-[font1] text-sm text-white/70">{plan.sessions}</div>

            {breakdown ? (
              <div className="mt-3 space-y-1.5 font-[font1] text-sm">
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
                    Total a pagar
                  </span>
                  <span className="font-[font1] text-2xl text-linen">
                    {formatBreakdown(breakdown.total, breakdown.currency)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="font-[font1] text-2xl mt-2 text-linen">
                {amountLabel} USD
              </div>
            )}
          </div>

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
                forma segura. Aceptan tarjeta débito, crédito y PSE.
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
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes popIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
};

export default MercadoPagoCheckoutModal;
