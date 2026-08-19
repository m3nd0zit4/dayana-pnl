"use client";

import { useState } from "react";

type Props = {
  planId: string;
  isDark: boolean;
  /** `subscription` solo funciona en planes con precio recurrente en Stripe. */
  mode?: "payment" | "subscription";
  label?: string;
};

/**
 * Stripe Checkout es una página alojada por Stripe: no hay modal ni SDK de
 * cliente, sólo un redirect. Por eso este botón no necesita provider ni
 * contexto, a diferencia de PayPal y Mercado Pago.
 */
const StripeCheckoutButton = ({
  planId,
  isDark,
  mode = "payment",
  label = "Pagar con tarjeta",
}: Props) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, mode, fromSession: true }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(
          data.error === "stripe_disabled"
            ? "Este medio de pago no está disponible por ahora."
            : "No se pudo abrir el pago. Intenta de nuevo."
        );
        setBusy(false);
        return;
      }
      // No se limpia `busy`: la navegación se lleva la página.
      window.location.assign(data.url);
    } catch {
      setError("No se pudo abrir el pago. Intenta de nuevo.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`group flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2.5 font-[font1] text-[12px] uppercase tracking-[0.2em] transition-all cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
          isDark
            ? "border-white/15 bg-white text-[#635bff] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#635bff] hover:bg-[#f6f5ff]"
            : "border-[#cdc9ff] bg-gradient-to-b from-white via-[#faf9ff] to-[#eeecff] text-[#635bff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(99,91,255,0.08)] hover:border-[#635bff] hover:shadow-[0_10px_28px_rgba(99,91,255,0.12)]"
        }`}
      >
        {busy ? "Abriendo…" : label}
      </button>
      {error && (
        <p
          role="alert"
          className={`text-center text-[11px] ${isDark ? "text-white/70" : "text-black/60"}`}
        >
          {error}
        </p>
      )}
    </div>
  );
};

export default StripeCheckoutButton;
