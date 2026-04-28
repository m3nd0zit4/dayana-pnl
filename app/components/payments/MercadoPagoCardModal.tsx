"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import { formatUsd, getPlan, type PlanId } from "../../../lib/plans";
import { MercadoPagoBrandRow } from "./MercadoPagoBrandRow";

type MercadoPagoCardModalProps = {
  planId: PlanId | null;
  onClose: () => void;
};

type UiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; paymentId?: number; status?: string };

type Breakdown = {
  subtotal: string;
  fee: string;
  total: string;
  currency: string;
};

const formatBreakdown = (value: string, currency: string): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} ${currency}`;
  if (currency === "COP") {
    return `${n.toLocaleString("es-CO", { maximumFractionDigits: 0 })} ${currency}`;
  }
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
};

type CardFormData = {
  token: string;
  paymentMethodId: string;
  issuerId?: string;
  amount?: string | number;
  installments?: string | number;
  payerEmail?: string;
  identificationType?: string;
  identificationNumber?: string;
};

type CardFormController = {
  mount?: () => void;
  unmount?: () => void;
  destroy?: () => void;
  getCardFormData: () => CardFormData;
};

type MercadoPagoCardFormOptions = {
  amount: string;
  autoMount?: boolean;
  iframe: boolean;
  form: {
    id: string;
    cardNumber: { id: string; placeholder: string };
    expirationDate: { id: string; placeholder: string };
    securityCode: { id: string; placeholder: string };
    cardholderName: { id: string; placeholder: string };
    issuer: { id: string; placeholder: string };
    installments: { id: string; placeholder: string };
    identificationType: { id: string; placeholder: string };
    identificationNumber: { id: string; placeholder: string };
    cardholderEmail: { id: string; placeholder: string };
  };
  callbacks: {
    onFormMounted?: (error?: { message?: string } | null) => void;
    onSubmit?: (event: Event) => void;
  };
};

type MercadoPagoSdk = {
  cardForm: (options: MercadoPagoCardFormOptions) => CardFormController;
};

type MercadoPagoConstructor = new (
  publicKey: string,
  options?: { locale?: string }
) => MercadoPagoSdk;

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

const SDK_SRC = "https://sdk.mercadopago.com/js/v2";

const loadMercadoPagoScript = async (): Promise<void> => {
  if (typeof window === "undefined") return;
  if (window.MercadoPago) return;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SRC}"]`
    );
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar SDK de Mercado Pago.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () =>
      reject(new Error("No se pudo cargar SDK de Mercado Pago."));
    document.head.appendChild(script);
  });
};

const MercadoPagoCardModal = ({ planId, onClose }: MercadoPagoCardModalProps) => {
  const open = planId !== null;
  const plan = planId ? getPlan(planId) : null;
  const amountLabel = useMemo(
    () => (plan ? formatUsd(plan.amountUsd) : ""),
    [plan]
  );
  const checkoutAmount = useMemo(() => {
    if (breakdown) {
      const n = Number(breakdown.total);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }, [breakdown]);

  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const formControllerRef = useRef<CardFormController | null>(null);
  const [formId, setFormId] = useState("");
  const isInitializingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setUi({ kind: "idle" });
      setBreakdown(null);
      setFormId("");
      isInitializingRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !plan) return;
    let cancelled = false;
    void fetch("/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: plan.id, provider: "mercadopago" }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as Partial<Breakdown>;
        if (cancelled) return;
        if (data.subtotal && data.fee && data.total && data.currency) {
          setBreakdown({
            subtotal: data.subtotal,
            fee: data.fee,
            total: data.total,
            currency: data.currency,
          });
        }
      })
      .catch(() => {
        /* sin desglose previo */
      });
    return () => {
      cancelled = true;
    };
  }, [open, plan]);

  useEffect(() => {
    if (!open || !plan) return;
    setFormId(`mp-card-form-${Math.random().toString(36).slice(2)}`);
  }, [open, plan]);

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
    const t = window.setTimeout(() => closeButtonRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open, plan]);

  useEffect(() => {
    if (!open || !plan || !formId) return;
    if (checkoutAmount <= 0) return;
    let cancelled = false;

    const destroyForm = () => {
      const form = formControllerRef.current;
      formControllerRef.current = null;
      try {
        form?.unmount?.();
      } catch {
        /* noop */
      }
      try {
        form?.destroy?.();
      } catch {
        /* noop */
      }
    };

    const run = async () => {
      if (isInitializingRef.current) return;
      isInitializingRef.current = true;
      setUi({ kind: "loading" });
      destroyForm();
      // Wait one frame so React renders the form container before cardForm init.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      if (cancelled) {
        isInitializingRef.current = false;
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;
      if (!publicKey) {
        setUi({
          kind: "error",
          message:
            "Falta NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY en .env. Agrega la public key y reinicia el servidor.",
        });
        isInitializingRef.current = false;
        return;
      }

      try {
        await loadMercadoPagoScript();
        if (cancelled) return;

        if (!window.MercadoPago) {
          setUi({
            kind: "error",
            message: "No fue posible iniciar Mercado Pago SDK.",
          });
          return;
        }

        const mp = new window.MercadoPago(publicKey, { locale: "es-CO" });
        const cardForm = mp.cardForm({
          amount: String(checkoutAmount),
          autoMount: true,
          iframe: true,
          form: {
            id: formId,
            cardNumber: {
              id: "mp-cardNumber",
              placeholder: "Número de tarjeta",
            },
            expirationDate: { id: "mp-expirationDate", placeholder: "MM/YY" },
            securityCode: { id: "mp-securityCode", placeholder: "CVV" },
            cardholderName: {
              id: "mp-cardholderName",
              placeholder: "Titular de la tarjeta",
            },
            issuer: { id: "mp-issuer", placeholder: "Banco emisor" },
            installments: { id: "mp-installments", placeholder: "Cuotas" },
            identificationType: {
              id: "mp-identificationType",
              placeholder: "Tipo de documento",
            },
            identificationNumber: {
              id: "mp-identificationNumber",
              placeholder: "Número de documento",
            },
            cardholderEmail: { id: "mp-cardholderEmail", placeholder: "Email" },
          },
          callbacks: {
            onFormMounted: (error) => {
              if (cancelled) return;
              if (error) {
                setUi({
                  kind: "error",
                  message:
                    error.message ??
                    "No se pudo montar el formulario de tarjeta.",
                });
                return;
              }
              setUi({ kind: "form" });
            },
            onSubmit: (event) => {
              event.preventDefault();
              if (cancelled) return;
              const data = cardForm.getCardFormData();
              setUi({ kind: "submitting" });
              void fetch("/api/mercadopago/card-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  planId: plan.id,
                  token: data.token,
                  payment_method_id: data.paymentMethodId,
                  issuer_id: data.issuerId,
                  transaction_amount:
                    Number(data.amount) > 0 ? Number(data.amount) : checkoutAmount,
                  installments: data.installments,
                  payer: {
                    email: data.payerEmail,
                    identification: {
                      type: data.identificationType,
                      number: data.identificationNumber,
                    },
                  },
                }),
              })
                .then(async (res) => {
                  const payload = (await res.json()) as {
                    ok?: boolean;
                    paymentId?: number;
                    message?: string;
                    status?: string;
                  };
                  if (!res.ok || !payload.ok) {
                    throw new Error(
                      payload.message ??
                        "No pudimos confirmar el pago. Revisa los datos e intenta de nuevo."
                    );
                  }
                  if (!cancelled) {
                    destroyForm();
                    setUi({
                      kind: "success",
                      paymentId: payload.paymentId,
                      status: payload.status,
                    });
                  }
                })
                .catch((error: unknown) => {
                  if (!cancelled) {
                    setUi({
                      kind: "error",
                      message:
                        error instanceof Error
                          ? error.message
                          : "No se pudo procesar el pago con tarjeta.",
                    });
                  }
                });
            },
          },
        });

        formControllerRef.current = cardForm;
      } catch (error) {
        if (!cancelled) {
          setUi({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Error iniciando Mercado Pago.",
          });
        }
      } finally {
        isInitializingRef.current = false;
      }
    };

    void run();
    return () => {
      cancelled = true;
      isInitializingRef.current = false;
      destroyForm();
    };
  }, [open, plan, checkoutAmount, formId]);

  if (!open || !plan) return null;
  if (typeof document === "undefined") return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      aria-modal="true"
      role="dialog"
      aria-label={`Pago con tarjeta - ${plan.title}`}
      className="fixed inset-0 z-[102] flex items-center justify-center p-4 lg:p-6 bg-black/80 backdrop-blur-md"
      onMouseDown={backdropClick}
    >
      <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-ink text-white border border-linen/15 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)]">
        <div className="relative flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-linen/10">
          <MercadoPagoBrandRow
            tone="onDark"
            subtitle="Tarjeta dentro de la página"
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
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="w-9 h-9 rounded-full border-2 border-linen/20 border-t-linen animate-spin" />
              <p className="font-[font1] text-sm text-white/55 text-center">
                Preparando pago con tarjeta...
              </p>
            </div>
          )}

          {(ui.kind === "loading" ||
            ui.kind === "form" ||
            ui.kind === "submitting" ||
            ui.kind === "error") && (
            <form
              id={formId}
              className={`space-y-3 ${ui.kind === "submitting" ? "opacity-65 pointer-events-none" : ""}`}
            >
              <div id="mp-cardNumber" className="mp-input" />
              <div className="grid grid-cols-2 gap-3">
                <div id="mp-expirationDate" className="mp-input" />
                <div id="mp-securityCode" className="mp-input" />
              </div>
              <div id="mp-cardholderName" className="mp-input" />
              <div className="grid grid-cols-2 gap-3">
                <select id="mp-issuer" className="mp-select" />
                <select id="mp-installments" className="mp-select" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select id="mp-identificationType" className="mp-select" />
                <input
                  id="mp-identificationNumber"
                  className="mp-native"
                  placeholder="Número de documento"
                />
              </div>
              <input
                id="mp-cardholderEmail"
                type="email"
                className="mp-native"
                placeholder="Email"
              />
              <button
                type="submit"
                className="w-full rounded-full bg-[#00a6e8] py-3 font-[font2] uppercase tracking-[0.18em] text-[11px] text-white hover:bg-[#0098d2] transition-colors cursor-pointer"
              >
                {ui.kind === "submitting"
                  ? "Procesando..."
                  : "Pagar con tarjeta"}
              </button>
            </form>
          )}

          {ui.kind === "error" && (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm font-[font1] text-red-200/90 mt-3">
              {ui.message}
            </div>
          )}

          {ui.kind === "success" && (
            <div className="flex flex-col items-center text-center py-2">
              <div className="font-[font2] uppercase text-2xl leading-tight">
                Pago aprobado
              </div>
              <p className="font-[font1] text-sm text-white/70 mt-3 max-w-sm leading-snug">
                Mercado Pago confirmó tu pago de{" "}
                <span className="text-linen">
                  {breakdown
                    ? formatBreakdown(breakdown.total, breakdown.currency)
                    : `${amountLabel} USD`}
                </span>
                . Ya puedes agendar por WhatsApp.
              </p>
              {ui.paymentId && (
                <div className="font-[font1] text-[11px] text-white/40 mt-3 break-all w-full">
                  Referencia: {ui.paymentId}
                  {ui.status ? ` (${ui.status})` : ""}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2 w-full mt-6">
                <a
                  href={buildWhatsAppUrl(
                    `Hola Dayana, pagué con Mercado Pago por ${
                      breakdown
                        ? formatBreakdown(breakdown.total, breakdown.currency)
                        : `${amountLabel} USD`
                    }${
                      ui.paymentId ? `. Ref: ${ui.paymentId}` : "."
                    } Quiero agendar.`
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:flex-1 rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.25em] py-3 hover:bg-white transition-colors text-center"
                >
                  Agendar por WhatsApp
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:flex-1 rounded-full border border-linen/30 text-white/80 font-[font2] uppercase text-xs tracking-[0.25em] py-3 hover:bg-linen/5 cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
              <p className="mt-4 font-[font1] text-[11px] text-white/35">
                o escríbenos al {WHATSAPP_NUMBER}
              </p>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        :global(.mp-input),
        :global(.mp-select),
        :global(.mp-native) {
          width: 100%;
          min-height: 48px;
          border-radius: 12px;
          border: 1px solid rgba(236, 227, 212, 0.18);
          background: rgba(236, 227, 212, 0.04);
          color: #f8f4ec;
          padding: 0 14px;
          font-family: var(--font1, ui-sans-serif);
          font-size: 14px;
        }
        :global(.mp-native::placeholder) {
          color: rgba(248, 244, 236, 0.45);
        }
      `}</style>
    </div>,
    document.body
  );
};

export default MercadoPagoCardModal;
