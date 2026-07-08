"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/app/components/ui/input-group";
import { Label } from "@/app/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/app/components/ui/toggle-group";
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
        <div className="rounded-xl border border-border bg-secondary/25 px-4 py-3">
          <p className="font-medium">{productTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{contactName}</p>
          {suggestedUsd && (
            <p className="mt-2 text-xs text-primary">
              Precio del servicio: ${suggestedUsd} {currency}
            </p>
          )}
        </div>

        <div>
          <Label className="mb-2">Monto rápido ({currency})</Label>
          <ToggleGroup
            value={amountUsd ? [amountUsd] : []}
            onValueChange={(v) => v[0] && setAmountUsd(v[0])}
            className="flex-wrap"
          >
            {quickAmounts.map((n) => (
              <ToggleGroupItem key={n} value={n.toFixed(2)} className="rounded-full">
                ${n.toFixed(0)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-pay-amount">Monto ({currency})</Label>
          <InputGroup>
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput
              id="reg-pay-amount"
              type="text"
              inputMode="decimal"
              placeholder="80.00"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </InputGroup>
        </div>

        <div>
          <Label className="mb-2">Método</Label>
          <ToggleGroup
            value={[method]}
            onValueChange={(v) => v[0] && setMethod(v[0] as typeof method)}
            className="flex-wrap"
          >
            {PAYMENT_METHODS.map((m) => (
              <ToggleGroupItem key={m.id} value={m.id} className="rounded-full">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-pay-ref">Referencia (opcional)</Label>
          <Input
            id="reg-pay-ref"
            placeholder="Ej. comprobante, últimos dígitos, nota breve…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={busy}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Al guardar, el pago queda aprobado y el servicio pasa a{" "}
          <strong className="font-medium text-foreground">Activo</strong>{" "}
          automáticamente (si no hay otra terapia activa).
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !amountUsd.trim()}
          >
            {busy ? "Guardando…" : "Registrar pago"}
          </Button>
        </div>
      </div>
    </CrmModal>
  );
};

export default RegisterPaymentModal;
