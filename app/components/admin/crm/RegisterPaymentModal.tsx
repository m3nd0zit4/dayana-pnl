"use client";

import { useEffect, useMemo, useState } from "react";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

const PAYMENT_METHODS = [
  { id: "transfer", label: "Transferencia" },
  { id: "cash", label: "Efectivo" },
  { id: "paypal", label: "PayPal" },
  { id: "nequi", label: "Nequi / Daviplata" },
  { id: "other", label: "Otro" },
] as const;

const FALLBACK_AMOUNTS_USD = [60, 80, 100, 120, 150, 200];

export type RegisteredPayment = {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  provider: string;
  providerOrderId?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  enrollmentId: string;
  productTitle: string;
  contactName: string;
  suggestedAmountMinor?: number | null;
  currency?: string;
  onSuccess?: (payment: RegisteredPayment) => void;
};

const formatUsd = (minor: number) => (minor / 100).toFixed(2);

const RegisterPaymentModal = ({
  open,
  onClose,
  enrollmentId,
  productTitle,
  contactName,
  suggestedAmountMinor,
  currency = "USD",
  onSuccess,
}: Props) => {
  const { toast } = useCrm();
  const [amountUsd, setAmountUsd] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["id"]>("transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const suggestedUsd = useMemo(() => {
    if (!suggestedAmountMinor || suggestedAmountMinor <= 0) return null;
    return formatUsd(suggestedAmountMinor);
  }, [suggestedAmountMinor]);

  const quickAmounts = useMemo(() => {
    const set = new Set<number>(FALLBACK_AMOUNTS_USD);
    if (suggestedAmountMinor && suggestedAmountMinor > 0) {
      set.add(suggestedAmountMinor / 100);
    }
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }, [suggestedAmountMinor]);

  useEffect(() => {
    if (!open) return;
    setAmountUsd(suggestedUsd ?? "");
    setMethod("transfer");
    setReference("");
    setBusy(false);
  }, [open, suggestedUsd]);

  const submit = async () => {
    const amount = Number.parseFloat(amountUsd.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Ingresa un monto válido", "error");
      return;
    }

    const methodLabel = PAYMENT_METHODS.find((m) => m.id === method)?.label ?? "Manual";
    const ref = reference.trim() || methodLabel;

    setBusy(true);
    const res = await fetch("/api/admin/payments/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enrollmentId,
        currency,
        amountMinor: Math.round(amount * 100),
        reference: ref,
      }),
    });
    setBusy(false);

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      payment?: RegisteredPayment;
    };

    if (!res.ok) {
      toast(
        data.error === "ACTIVE_THERAPY_EXISTS"
          ? "Este contacto ya tiene otra terapia activa"
          : "No se pudo registrar el pago",
        "error"
      );
      return;
    }

    if (data.payment) {
      onSuccess?.(data.payment);
      toast({
        title: "Pago registrado",
        message: `$${amount.toFixed(2)} ${currency} · el servicio queda activo.`,
        variant: "success",
      });
      onClose();
    }
  };

  return (
    <CrmModal open={open} title="Registrar pago" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-linen)]/25 px-4 py-3">
          <p className="font-medium">{productTitle}</p>
          <p className="mt-0.5 text-xs text-[var(--crm-muted)]">{contactName}</p>
          {suggestedUsd && (
            <p className="mt-2 text-xs text-[var(--crm-accent)]">
              Precio del servicio: ${suggestedUsd} {currency}
            </p>
          )}
        </div>

        <div>
          <p className="crm-label mb-2">Monto rápido ({currency})</p>
          <div className="flex flex-wrap gap-2">
            {quickAmounts.map((n) => (
              <button
                key={n}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  amountUsd === n.toFixed(2) || amountUsd === String(n)
                    ? "border-[var(--crm-accent)] bg-[var(--crm-accent-soft)] text-[var(--crm-accent)]"
                    : "border-[var(--crm-border)] text-[var(--crm-muted)] hover:border-[var(--crm-sand)]"
                }`}
                onClick={() => setAmountUsd(n.toFixed(2))}
              >
                ${n.toFixed(0)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="crm-label" htmlFor="reg-pay-amount">
            Monto ({currency})
          </label>
          <div className="crm-phone-field mt-1">
            <span className="crm-phone-prefix" aria-hidden>
              $
            </span>
            <input
              id="reg-pay-amount"
              type="text"
              inputMode="decimal"
              className="crm-phone-input"
              placeholder="80.00"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
        </div>

        <div>
          <p className="crm-label mb-2">Método</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  method === m.id
                    ? "border-[var(--crm-accent)] bg-[var(--crm-accent-soft)] text-[var(--crm-accent)]"
                    : "border-[var(--crm-border)] text-[var(--crm-muted)] hover:border-[var(--crm-sand)]"
                }`}
                onClick={() => setMethod(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="crm-label" htmlFor="reg-pay-ref">
            Referencia (opcional)
          </label>
          <input
            id="reg-pay-ref"
            className="crm-input mt-1"
            placeholder="Ej. comprobante, últimos dígitos, nota breve…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={busy}
          />
        </div>

        <p className="text-xs text-[var(--crm-muted)]">
          Al guardar, el pago queda aprobado y el servicio pasa a{" "}
          <strong className="font-medium text-[var(--crm-foreground)]">Activo</strong>{" "}
          automáticamente (si no hay otra terapia activa).
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="crm-btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="crm-btn-primary"
            onClick={() => void submit()}
            disabled={busy || !amountUsd.trim()}
          >
            {busy ? "Guardando…" : "Registrar pago"}
          </button>
        </div>
      </div>
    </CrmModal>
  );
};

export default RegisterPaymentModal;
