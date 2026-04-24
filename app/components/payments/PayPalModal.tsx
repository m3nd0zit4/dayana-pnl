"use client";

import { loadScript } from "@paypal/paypal-js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "../../../lib/contact";
import { formatUsd, getPlan, type PlanId } from "../../../lib/plans";
import { PayPalBrandRow } from "./PayPalBrandRow";

type PayPalModalProps = {
  planId: PlanId | null;
  onClose: () => void;
};

type UiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "buttons" }
  | { kind: "error"; message: string }
  | { kind: "success"; orderID: string; captureId?: string };

const PayPalModal = ({ planId, onClose }: PayPalModalProps) => {
  const open = planId !== null;
  const plan = planId ? getPlan(planId) : null;

  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const paypalHostRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const buttonsCloseRef = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    if (!open) {
      setUi({ kind: "idle" });
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
    if (!open || !plan || !paypalHostRef.current) return;

    let cancelled = false;
    const host = paypalHostRef.current;

    const teardownButtons = async () => {
      const close = buttonsCloseRef.current;
      buttonsCloseRef.current = null;
      if (close) {
        try {
          await close();
        } catch {
          /* ignore */
        }
      }
      host.innerHTML = "";
    };

    const run = async () => {
      setUi({ kind: "loading" });
      await teardownButtons();

      const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
      if (!clientId) {
        setUi({
          kind: "error",
          message:
            "Falta NEXT_PUBLIC_PAYPAL_CLIENT_ID. Añádelo en .env.local y reinicia el servidor.",
        });
        return;
      }

      try {
        const paypal = await loadScript({
          clientId,
          currency: "USD",
          intent: "capture",
        });

        if (cancelled) return;

        if (!paypal?.Buttons) {
          setUi({
            kind: "error",
            message: "No se pudo cargar el SDK de PayPal. Revisa la red o el client id.",
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
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ planId: plan.id }),
            });
            const data = (await res.json()) as {
              orderID?: string;
              message?: string;
            };
            if (!res.ok || !data.orderID) {
              throw new Error(
                data.message ?? "No se pudo crear la orden en PayPal."
              );
            }
            return data.orderID;
          },
          onApprove: async (data) => {
            const res = await fetch("/api/paypal/capture-order", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ orderID: data.orderID }),
            });
            const payload = (await res.json()) as {
              ok?: boolean;
              captureId?: string;
              message?: string;
            };
            if (!res.ok || !payload.ok) {
              throw new Error(
                payload.message ?? "No se pudo confirmar el pago."
              );
            }
            await teardownButtons();
            if (!cancelled) {
              setUi({
                kind: "success",
                orderID: data.orderID,
                captureId: payload.captureId,
              });
            }
          },
          onError: (err) => {
            console.error(err);
            if (!cancelled) {
              void teardownButtons();
              setUi({
                kind: "error",
                message:
                  "PayPal cerró el pago o hubo un error. Prueba de nuevo o usa tarjeta (Compra).",
              });
            }
          },
          onCancel: async () => {
            await teardownButtons();
            if (!cancelled) {
              setUi({
                kind: "error",
                message:
                  "Cancelaste el pago en PayPal. Cierra y vuelve a abrir PayPal cuando quieras.",
              });
            }
          },
        });

        buttonsCloseRef.current = () => buttons.close();
        await buttons.render(host);
        if (!cancelled) setUi({ kind: "buttons" });
      } catch (e) {
        if (!cancelled) {
          setUi({
            kind: "error",
            message:
              e instanceof Error
                ? e.message
                : "Error al iniciar PayPal. Verifica PAYPAL_CLIENT_ID / SECRET y PAYPAL_MODE.",
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      void teardownButtons();
    };
  }, [open, plan]);

  if (!open || !plan) return null;
  if (typeof document === "undefined") return null;

  const backdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const amountLabel = formatUsd(plan.amountUsd);

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
            <div className="font-[font1] text-2xl mt-2 text-linen">{amountLabel} USD</div>
          </div>

          {ui.kind === "success" && (
            <PayPalSuccess
              amountLabel={amountLabel}
              orderID={ui.orderID}
              captureId={ui.captureId}
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
            className={`min-h-[52px] ${ui.kind === "success" ? "hidden" : ""} ${ui.kind === "loading" ? "pointer-events-none opacity-40" : ""}`}
            aria-hidden={ui.kind === "success"}
          />

          {ui.kind === "error" && (
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-full border border-linen/30 py-3 font-[font2] uppercase text-xs tracking-[0.2em] text-white/80 hover:bg-linen/5 cursor-pointer"
            >
              Cerrar
            </button>
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
  onClose: () => void;
};

const PayPalSuccess = ({
  amountLabel,
  orderID,
  captureId,
  onClose,
}: PayPalSuccessProps) => {
  const whatsappHref = buildWhatsAppUrl(
    `Hola Dayana, pagué con PayPal por ${amountLabel} USD. Orden: ${orderID}${
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
        <span className="text-linen">{amountLabel} USD</span>. El siguiente paso
        es coordinar por WhatsApp.
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
      <div className="flex flex-col sm:flex-row gap-2 w-full mt-6">
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
      <p className="mt-4 font-[font1] text-[11px] text-white/35">
        o escríbenos al {WHATSAPP_NUMBER}
      </p>
    </div>
  );
};

export default PayPalModal;
