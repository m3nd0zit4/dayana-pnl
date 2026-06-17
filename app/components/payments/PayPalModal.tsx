"use client";

import { loadScript } from "@paypal/paypal-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import {
  buildPayPalScriptOptions,
  fetchPayPalSdkConfig,
  isBenignPayPalSdkError,
  readJsonResponse,
} from "../../../lib/paypal/client";
import { formatUsd, getPlan, type PlanId } from "../../../lib/plans";
import { PayPalBrandRow } from "./PayPalBrandRow";
import CheckoutContactStep, {
  type CheckoutContactPayload,
} from "./CheckoutContactStep";

type PayPalModalProps = {
  planId: PlanId | null;
  onClose: () => void;
};

type Breakdown = {
  subtotal: string;
  fee: string;
  total: string;
};

const PAYPAL_CANCEL_MESSAGE =
  "Cancelaste el pago en PayPal. Puedes reintentar o cerrar el modal.";

const PAYPAL_ERROR_MESSAGE =
  "PayPal cerró el pago o hubo un error. Prueba de nuevo o usa tarjeta (Compra).";

type UiState =
  | { kind: "idle" }
  | { kind: "contact" }
  | { kind: "loading" }
  | { kind: "buttons" }
  | { kind: "error"; message: string; retryable?: boolean }
  | { kind: "success"; orderID: string; captureId?: string; enrollmentId?: string };

const usdLabel = (value: string): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} USD`;
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
};

const PayPalModal = ({ planId, onClose }: PayPalModalProps) => {
  const open = planId !== null;
  const plan = planId ? getPlan(planId) : null;

  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [contactPayload, setContactPayload] = useState<CheckoutContactPayload | null>(
    null
  );
  const [buttonsEpoch, setButtonsEpoch] = useState(0);

  const contactPayloadRef = useRef<CheckoutContactPayload | null>(null);
  const paypalHostRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const buttonsCloseRef = useRef<null | (() => Promise<void>)>(null);
  const pendingEnrollmentIdRef = useRef<string | undefined>(undefined);
  const checkoutSucceededRef = useRef(false);
  const paypalFlowActiveRef = useRef(false);
  const orderCreatedRef = useRef(false);

  const abandonPendingCheckout = useCallback(() => {
    const id = pendingEnrollmentIdRef.current;
    if (!id) return;
    pendingEnrollmentIdRef.current = undefined;
    void fetch("/api/checkout/abandon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId: id }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const requestClose = useCallback(() => {
    if (paypalFlowActiveRef.current) {
      setUi({
        kind: "error",
        message:
          "Hay un pago de PayPal en curso. Complétalo o cancélalo en la ventana de PayPal antes de cerrar.",
        retryable: true,
      });
      return;
    }
    onClose();
  }, [onClose]);

  const retryPayPalButtons = useCallback(() => {
    paypalFlowActiveRef.current = false;
    orderCreatedRef.current = Boolean(pendingEnrollmentIdRef.current);
    setUi({ kind: "loading" });
    setButtonsEpoch((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      setUi({ kind: "idle" });
      setBreakdown(null);
      setContactPayload(null);
      contactPayloadRef.current = null;
      paypalFlowActiveRef.current = false;
      orderCreatedRef.current = false;
      if (!checkoutSucceededRef.current) {
        abandonPendingCheckout();
      }
      checkoutSucceededRef.current = false;
      setButtonsEpoch(0);
    } else {
      checkoutSucceededRef.current = false;
      pendingEnrollmentIdRef.current = undefined;
      orderCreatedRef.current = false;
      paypalFlowActiveRef.current = false;
      setUi({ kind: "contact" });
    }
  }, [open, abandonPendingCheckout]);

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
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

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
    void fetch("/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: plan.id, provider: "paypal" }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await readJsonResponse<Partial<Breakdown>>(res);
        if (cancelled) return;
        if (data.subtotal && data.fee && data.total) {
          setBreakdown({
            subtotal: data.subtotal,
            fee: data.fee,
            total: data.total,
          });
        }
      })
      .catch(() => {
        /* sin desglose previo: se muestra solo el subtotal del plan */
      });
    return () => {
      cancelled = true;
    };
  }, [open, plan]);

  useEffect(() => {
    if (!open || !plan || !contactPayload || checkoutSucceededRef.current) return;

    let cancelled = false;

    const teardownButtons = async (force = false) => {
      if (paypalFlowActiveRef.current && !force) return;
      const host = paypalHostRef.current;
      const close = buttonsCloseRef.current;
      buttonsCloseRef.current = null;
      if (close) {
        try {
          await close();
        } catch {
          /* ignore */
        }
      }
      if (host) host.replaceChildren();
    };

    let enrollmentIdRef: string | undefined;

    const run = async () => {
      setUi({ kind: "loading" });
      await teardownButtons(true);

      const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
      if (!clientId) {
        setUi({
          kind: "error",
          message:
            "Falta NEXT_PUBLIC_PAYPAL_CLIENT_ID. Añádelo en .env y reinicia el servidor.",
        });
        return;
      }

      try {
        const sdkConfig = await fetchPayPalSdkConfig();
        const paypal = await loadScript(
          buildPayPalScriptOptions(sdkConfig.clientId, sdkConfig.environment)
        );

        if (cancelled) return;

        if (!paypal?.Buttons) {
          setUi({
            kind: "error",
            message: "No se pudo cargar el SDK de PayPal. Revisa la red o el client id.",
            retryable: true,
          });
          return;
        }

        let host = paypalHostRef.current;
        for (let attempt = 0; attempt < 3 && !host; attempt += 1) {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
          host = paypalHostRef.current;
        }
        if (!host) {
          setUi({
            kind: "error",
            message: "No se pudo iniciar PayPal. Cierra y vuelve a abrir el modal.",
            retryable: true,
          });
          return;
        }

        const buttons = paypal.Buttons({
          style: {
            layout: "vertical",
            shape: "pill",
            label: "paypal",
            borderRadius: 12,
            height: 48,
          },
          createOrder: async () => {
            paypalFlowActiveRef.current = true;
            const contact = contactPayloadRef.current;
            if (!contact) {
              paypalFlowActiveRef.current = false;
              throw new Error("Completa tus datos de contacto primero.");
            }
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                planId: plan.id,
                ...contact,
                enrollmentId: pendingEnrollmentIdRef.current,
              }),
            });
            const data = await readJsonResponse<{
              orderID?: string;
              enrollmentId?: string;
              message?: string;
              breakdown?: Breakdown;
            }>(res);
            if (!res.ok || !data.orderID) {
              paypalFlowActiveRef.current = false;
              throw new Error(
                data.message ?? "No se pudo crear la orden en PayPal."
              );
            }
            if (data.breakdown && !cancelled) {
              setBreakdown(data.breakdown);
            }
            enrollmentIdRef = data.enrollmentId;
            pendingEnrollmentIdRef.current = data.enrollmentId;
            orderCreatedRef.current = true;
            return data.orderID;
          },
          onApprove: async (data) => {
            try {
              const res = await fetch("/api/paypal/capture-order", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ orderID: data.orderID }),
              });
              const payload = await readJsonResponse<{
                ok?: boolean;
                captureId?: string;
                enrollmentId?: string;
                message?: string;
              }>(res);
              if (!res.ok || !payload.ok) {
                throw new Error(
                  payload.message ?? "No se pudo confirmar el pago."
                );
              }
              paypalFlowActiveRef.current = false;
              await teardownButtons(true);
              checkoutSucceededRef.current = true;
              pendingEnrollmentIdRef.current = undefined;
              orderCreatedRef.current = false;
              if (!cancelled) {
                setUi({
                  kind: "success",
                  orderID: data.orderID,
                  captureId: payload.captureId,
                  enrollmentId: payload.enrollmentId ?? enrollmentIdRef,
                });
              }
            } catch (e) {
              paypalFlowActiveRef.current = false;
              if (!cancelled) {
                setUi({
                  kind: "error",
                  message:
                    e instanceof Error
                      ? e.message
                      : "No se pudo confirmar el pago.",
                  retryable: true,
                });
              }
              throw e;
            }
          },
          onError: (err) => {
            if (cancelled) return;
            paypalFlowActiveRef.current = false;

            if (isBenignPayPalSdkError(err)) {
              if (!cancelled) {
                setUi({
                  kind: "error",
                  message: PAYPAL_CANCEL_MESSAGE,
                  retryable: true,
                });
              }
              return;
            }

            if (!orderCreatedRef.current) {
              abandonPendingCheckout();
            }

            if (!cancelled) {
              setUi({
                kind: "error",
                message: PAYPAL_ERROR_MESSAGE,
                retryable: true,
              });
            }
          },
          onCancel: () => {
            if (cancelled) return;
            paypalFlowActiveRef.current = false;
            if (!cancelled) {
              setUi({
                kind: "error",
                message: PAYPAL_CANCEL_MESSAGE,
                retryable: true,
              });
            }
          },
        });

        if (!buttons.isEligible()) {
          setUi({
            kind: "error",
            message:
              "PayPal no está disponible en este navegador. Prueba con tarjeta (Compra) o WhatsApp.",
          });
          return;
        }

        buttonsCloseRef.current = () => buttons.close();
        await buttons.render(host);
        if (!cancelled) setUi({ kind: "buttons" });
      } catch (e) {
        paypalFlowActiveRef.current = false;
        if (!cancelled) {
          const base =
            e instanceof Error
              ? e.message
              : "Error al iniciar PayPal. Verifica PAYPAL_CLIENT_ID / SECRET y PAYPAL_MODE.";
          const hint =
            base.toLowerCase().includes("failed to load") ||
            base.toLowerCase().includes("script")
              ? " Si tu Client ID es de producción, usa PAYPAL_MODE=live (no sandbox)."
              : "";
          setUi({
            kind: "error",
            message: `${base}${hint}`,
            retryable: true,
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (!paypalFlowActiveRef.current) {
        void teardownButtons(true);
      }
    };
  }, [open, plan, contactPayload, buttonsEpoch, abandonPendingCheckout]);

  if (!open || !plan) return null;
  if (typeof document === "undefined") return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      requestClose();
    }
  };

  const amountLabel = formatUsd(plan.amountUsd);
  const showPayPalHost = ui.kind === "buttons" || ui.kind === "loading";

  const content = (
    <div
      aria-modal="true"
      role="dialog"
      aria-label={`Pago PayPal — ${plan.title}`}
      className="fixed inset-0 z-[101] flex items-center justify-center p-4 lg:p-6 bg-black/80 backdrop-blur-md animate-[fadeIn_200ms_ease-out]"
      onMouseDown={backdropClick}
    >
      <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-ink text-white border border-linen/15 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] animate-[popIn_240ms_cubic-bezier(0.22,1,0.36,1)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none rounded-2xl opacity-80"
          style={{
            background:
              "radial-gradient(60% 40% at 0% 0%, rgba(236,227,212,0.10), transparent 60%), radial-gradient(50% 45% at 100% 100%, rgba(237,195,177,0.14), transparent 65%)",
          }}
        />

        <div className="relative flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-linen/10">
          <PayPalBrandRow
            tone="onDark"
            subtitle="Checkout seguro"
            className="items-start text-left"
          />
          <button
            type="button"
            ref={closeButtonRef}
            onClick={requestClose}
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
                  <span>{usdLabel(breakdown.subtotal)}</span>
                </div>
                <div className="flex justify-between text-white/55">
                  <span>Comisión PayPal</span>
                  <span>+ {usdLabel(breakdown.fee)}</span>
                </div>
                <div className="border-t border-linen/12 my-2" />
                <div className="flex justify-between items-baseline">
                  <span className="font-[font2] uppercase text-[10px] tracking-[0.3em] text-linen/70">
                    Total a pagar
                  </span>
                  <span className="font-[font1] text-2xl text-linen">
                    {usdLabel(breakdown.total)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="font-[font1] text-2xl mt-2 text-linen">
                {amountLabel} USD
              </div>
            )}
          </div>

          {ui.kind === "contact" && (
            <CheckoutContactStep
              submitLabel="Continuar con PayPal"
              onSubmit={(payload) => {
                contactPayloadRef.current = payload;
                setContactPayload(payload);
                setUi({ kind: "loading" });
              }}
            />
          )}

          {ui.kind === "success" && (
            <PayPalSuccess
              amountLabel={
                breakdown ? usdLabel(breakdown.total) : `${amountLabel} USD`
              }
              orderID={ui.orderID}
              captureId={ui.captureId}
              enrollmentId={ui.enrollmentId}
              onClose={onClose}
            />
          )}

          {ui.kind === "loading" && (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="w-9 h-9 rounded-full border-2 border-linen/20 border-t-linen animate-spin" />
              <p className="font-[font1] text-sm text-white/55 text-center">
                Conectando con PayPal…
              </p>
            </div>
          )}

          {ui.kind === "error" && (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm font-[font1] text-red-200/90 mb-4">
              {ui.message}
            </div>
          )}

          <div
            ref={paypalHostRef}
            className={`min-h-[52px] ${
              showPayPalHost ? "" : "hidden"
            } ${ui.kind === "loading" ? "sr-only" : ""}`}
            aria-hidden={!showPayPalHost || ui.kind === "loading"}
          />

          {ui.kind === "error" && (
            <div className="flex flex-col gap-2 mt-4">
              {ui.retryable && contactPayload && (
                <button
                  type="button"
                  onClick={retryPayPalButtons}
                  className="w-full rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.2em] py-3 hover:bg-white transition-colors cursor-pointer"
                >
                  Reintentar PayPal
                </button>
              )}
              <button
                type="button"
                onClick={requestClose}
                className="w-full rounded-full border border-linen/30 py-3 font-[font2] uppercase text-xs tracking-[0.2em] text-white/80 hover:bg-linen/5 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes popIn {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
};

type PayPalSuccessProps = {
  amountLabel: string;
  orderID: string;
  captureId?: string;
  enrollmentId?: string;
  onClose: () => void;
};

const PayPalSuccess = ({
  amountLabel,
  orderID,
  captureId,
  onClose,
}: PayPalSuccessProps) => {
  const whatsappHref = buildWhatsAppUrl(
    `Hola Dayana, pagué con PayPal por ${amountLabel}. Orden: ${orderID}${
      captureId ? `. Captura: ${captureId}.` : "."
    } Quiero agendar.`
  );

  return (
    <div className="flex flex-col items-center text-center py-2">
      <div className="font-[font2] uppercase text-2xl leading-tight">
        Pago recibido
      </div>
      <p className="font-[font1] text-sm text-white/70 mt-3 max-w-sm leading-snug">
        PayPal confirmó tu pago de{" "}
        <span className="text-linen">{amountLabel}</span>. El siguiente paso es
        coordinar por WhatsApp.
      </p>
      <div className="font-[font1] text-[11px] text-white/40 mt-3 break-all w-full">
        Orden: {orderID}
        {captureId && (
          <>
            <br />
            Captura: {captureId}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 w-full mt-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <a
            href={whatsappHref}
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
      </div>
      <p className="mt-4 font-[font1] text-[11px] text-white/35">
        o escríbenos al {WHATSAPP_NUMBER}
      </p>
    </div>
  );
};

export default PayPalModal;
