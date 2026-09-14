"use client";

import { useMemo, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/app/components/ui/input-group";
import { Label } from "@/app/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/app/components/ui/toggle-group";
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

export type RegisterPaymentFormProps = {
  /**
   * El servicio al que se imputa el pago. `null` cuando todavía no existe: se
   * crea con `ensureEnrollment` justo al pedir el código, no antes, para no
   * dejar servicios a medias si se cierra el diálogo sin llegar a pagar.
   */
  enrollmentId: string | null;
  ensureEnrollment?: () => Promise<string | null>;
  productTitle: string;
  contactName: string;
  suggestedAmountMinor?: number | null;
  currency?: string;
  /** Si la moneda no viene dada por un servicio existente, se elige aquí. */
  allowCurrencyChoice?: boolean;
  onSuccess?: (payment: RegisteredPayment) => void;
  /** Cierra o vuelve atrás, según quién lo pinte. */
  onCancel: () => void;
  cancelLabel?: string;
};

export const formatMajor = (minor: number, currency: string) => {
  const major = minorToMajor(minor, currency);
  return currency === "COP" ? String(Math.round(major)) : major.toFixed(2);
};

/**
 * El formulario de un pago manual: monto, método, referencia y el código de
 * verificación que se envía por correo.
 *
 * Lo pintan el flujo de «Registrar pago» (Pagos, ficha del contacto,
 * Membresías) y el detalle de un servicio. Antes era un modal completo que
 * sólo sabía trabajar con un servicio ya elegido, y por eso no se podía
 * registrar un pago desde la pantalla de Pagos.
 */
const RegisterPaymentForm = ({
  enrollmentId: initialEnrollmentId,
  ensureEnrollment,
  productTitle,
  contactName,
  suggestedAmountMinor,
  currency: initialCurrency = "USD",
  allowCurrencyChoice = false,
  onSuccess,
  onCancel,
  cancelLabel = "Cancelar",
}: RegisterPaymentFormProps) => {
  const { toast, role } = useCrm();
  const [enrollmentId, setEnrollmentId] = useState(initialEnrollmentId);
  const [currency, setCurrency] = useState(initialCurrency);
  const suggestedDisplay =
    suggestedAmountMinor && suggestedAmountMinor > 0
      ? formatMajor(suggestedAmountMinor, currency)
      : null;
  const [amountInput, setAmountInput] = useState(suggestedDisplay ?? "");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["id"]>("transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);

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

  const requestCode = async () => {
    setSendingCode(true);
    let id = enrollmentId;
    if (!id && ensureEnrollment) {
      id = await ensureEnrollment();
      if (!id) {
        setSendingCode(false);
        return;
      }
      setEnrollmentId(id);
    }
    if (!id) {
      setSendingCode(false);
      return;
    }

    const res = await fetch("/api/admin/payments/manual/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId: id }),
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
    if (!enrollmentId) return;

    const methodLabel = PAYMENT_METHODS.find((m) => m.id === method)?.label ?? "Manual";
    const ref = reference.trim() || methodLabel;

    setBusy(true);
    const res = await fetch("/api/admin/payments/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enrollmentId,
        currency,
        amountMinor: majorToMinor(amount, currency),
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
      toast({
        title: "Pago registrado",
        message: `$${formatMajor(majorToMinor(amount, currency), currency)} ${currency} · el servicio queda activo.`,
        variant: "success",
      });
      onSuccess?.(data.payment);
    }
  };

  const quickAmountLabel = (n: number) =>
    currency === "COP" ? n.toLocaleString("es-CO") : n.toFixed(0);
  const quickAmountValue = (n: number) => (currency === "COP" ? String(n) : n.toFixed(2));

  return (
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

      {allowCurrencyChoice && !otpSent ? (
        <div>
          <Label className="mb-2">Moneda</Label>
          <ToggleGroup
            value={[currency]}
            onValueChange={(v) => {
              if (!v[0]) return;
              setCurrency(v[0]);
              setAmountInput("");
            }}
          >
            <ToggleGroupItem value="COP" className="rounded-full">COP</ToggleGroupItem>
            <ToggleGroupItem value="USD" className="rounded-full">USD</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}

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
            {role === "OWNER"
              ? "Te llegó un código de 6 dígitos al correo de verificación."
              : "Se envió un código de 6 dígitos por correo — pídeselo a Dayana para confirmar el pago."}
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

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy || sendingCode}>
          {cancelLabel}
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
  );
};

export default RegisterPaymentForm;
