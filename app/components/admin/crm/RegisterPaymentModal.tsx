"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/app/components/ui/input-group";
import { Label } from "@/app/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/app/components/ui/toggle-group";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";
import { majorToMinor, minorToMajor } from "@/lib/crm/money";

const PAYMENT_METHODS = [
  { id: "transfer", label: "Transferencia" },
  { id: "cash", label: "Efectivo" },
  { id: "paypal", label: "PayPal" },
  { id: "nequi", label: "Nequi / Daviplata" },
  { id: "other", label: "Otro" },
] as const;

// COP se guarda en pesos completos (sin centavos) — ver CLAUDE.md. Los
// montos rápidos y el redondeo de minor units dependen de la moneda: mezclar
// escalas (mostrar/registrar montos USD para un servicio en COP) generaba
// pagos sin relación real con el precio del servicio.
const FALLBACK_AMOUNTS_USD = [60, 80, 100, 120, 150, 200];
const FALLBACK_AMOUNTS_COP = [50000, 100000, 150000, 200000, 280000, 350000];

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

const formatMajor = (minor: number, currency: string) => {
  const major = minorToMajor(minor, currency);
  return currency === "COP" ? String(Math.round(major)) : major.toFixed(2);
};

const toMinor = majorToMinor;

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
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["id"]>("transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);

  const suggestedDisplay = useMemo(() => {
    if (!suggestedAmountMinor || suggestedAmountMinor <= 0) return null;
    return formatMajor(suggestedAmountMinor, currency);
  }, [suggestedAmountMinor, currency]);

  const quickAmounts = useMemo(() => {
    const fallback = currency === "COP" ? FALLBACK_AMOUNTS_COP : FALLBACK_AMOUNTS_USD;
    const set = new Set<number>(fallback);
    if (suggestedAmountMinor && suggestedAmountMinor > 0) {
      set.add(
        currency === "COP" ? Math.round(suggestedAmountMinor) : suggestedAmountMinor / 100
      );
    }
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }, [suggestedAmountMinor, currency]);

  useEffect(() => {
    if (!open) return;
    setAmountInput(suggestedDisplay ?? "");
    setMethod("transfer");
    setReference("");
    setBusy(false);
    setOtpSent(false);
    setOtpCode("");
    setSendingCode(false);
  }, [open, suggestedDisplay]);

  const requestCode = async () => {
    setSendingCode(true);
    const res = await fetch("/api/admin/payments/manual/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId }),
    });
    setSendingCode(false);

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast(
        data.error === "rate_limited"
          ? "Demasiados códigos solicitados — espera unos minutos"
          : "No se pudo enviar el código de verificación",
        "error"
      );
      return;
    }

    setOtpSent(true);
    setOtpCode("");
    toast("Código enviado — revisa el correo de verificación");
  };

  const submit = async () => {
    const amount = Number.parseFloat(amountInput.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Ingresa un monto válido", "error");
      return;
    }
    if (!otpCode.trim()) {
      toast("Ingresa el código de verificación", "error");
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
        amountMinor: toMinor(amount, currency),
        reference: ref,
        code: otpCode.trim(),
      }),
    });
    setBusy(false);

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      maxAmountMinor?: number;
      payment?: RegisteredPayment;
    };

    if (!res.ok) {
      const messages: Record<string, string> = {
        ACTIVE_THERAPY_EXISTS: "Este contacto ya tiene otra terapia activa",
        invalid_code: "Código incorrecto",
        expired_code: "El código venció o no se ha solicitado — pide uno nuevo",
        too_many_attempts: "Demasiados intentos — solicita un código nuevo",
        AMOUNT_EXCEEDS_SERVICE_PRICE:
          data.maxAmountMinor != null
            ? `El monto no puede superar el precio del servicio ($${formatMajor(data.maxAmountMinor, currency)} ${currency})`
            : "El monto no puede superar el precio del servicio",
      };
      toast(messages[data.error ?? ""] ?? "No se pudo registrar el pago", "error");
      if (data.error === "expired_code" || data.error === "too_many_attempts") {
        setOtpSent(false);
        setOtpCode("");
      }
      return;
    }

    if (data.payment) {
      onSuccess?.(data.payment);
      toast({
        title: "Pago registrado",
        message: `$${formatMajor(toMinor(amount, currency), currency)} ${currency} · el servicio queda activo.`,
        variant: "success",
      });
      onClose();
    }
  };

  const quickAmountLabel = (n: number) =>
    currency === "COP" ? n.toLocaleString("es-CO") : n.toFixed(0);
  const quickAmountValue = (n: number) => (currency === "COP" ? String(n) : n.toFixed(2));

  return (
    <CrmModal open={open} title="Registrar pago" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-border bg-secondary/25 px-4 py-3">
          <p className="font-medium">{productTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{contactName}</p>
          {suggestedDisplay && (
            <p className="mt-2 text-xs text-primary">
              Precio del servicio: ${suggestedDisplay} {currency}
            </p>
          )}
        </div>

        <div>
          <Label className="mb-2">Monto rápido ({currency})</Label>
          <ToggleGroup
            value={amountInput ? [amountInput] : []}
            onValueChange={(v) => v[0] && setAmountInput(v[0])}
            className="flex-wrap"
          >
            {quickAmounts.map((n) => (
              <ToggleGroupItem key={n} value={quickAmountValue(n)} className="rounded-full">
                ${quickAmountLabel(n)}
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
              placeholder={currency === "COP" ? "280000" : "80.00"}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
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

        {otpSent && (
          <div className="space-y-1.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <Label htmlFor="reg-pay-otp">Código de verificación</Label>
            <p className="text-xs text-muted-foreground">
              Se envió un código de 6 dígitos por correo — pídeselo a Dayana para
              confirmar el pago.
            </p>
            <Input
              id="reg-pay-otp"
              inputMode="numeric"
              placeholder="123456"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-0 text-xs"
              onClick={() => void requestCode()}
              disabled={sendingCode}
            >
              {sendingCode ? "Reenviando…" : "Reenviar código"}
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy || sendingCode}>
            Cancelar
          </Button>
          {otpSent ? (
            <Button
              onClick={() => void submit()}
              disabled={busy || !amountInput.trim() || !otpCode.trim()}
            >
              {busy ? "Guardando…" : "Confirmar y registrar"}
            </Button>
          ) : (
            <Button
              onClick={() => void requestCode()}
              disabled={sendingCode || !amountInput.trim()}
            >
              {sendingCode ? "Enviando código…" : "Enviar código de verificación"}
            </Button>
          )}
        </div>
      </div>
    </CrmModal>
  );
};

export default RegisterPaymentModal;
