"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { useCrm } from "../CrmProvider";
import { CrmField } from "../ui";
import EditionSaveBar from "../editions/EditionSaveBar";
import { useDirtyBaseline, useUnsavedChangesGuard } from "../editions/dirty-guard";

type Props = {
  slug: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";
  /** Precio propio vigente: COP en pesos, USD en centavos. */
  prices: { cop: number | null; usd: number | null };
  /** Cobra con un paquete compartido heredado (p. ej. `workshop-virtual`). */
  legacy: { productTitle: string; priceText: string } | null;
};

const COP_RE = /^\d+$/;
const USD_RE = /^\d+(\.\d{1,2})?$/;
const INVALID = "Revisa los precios: pesos enteros mayores que cero y dólares con máximo dos decimales.";

const ERRORS: Record<string, string> = {
  invalid_price: INVALID,
  open_requires_cop_price: "Publicado, este taller necesita su precio en pesos (COP).",
  price_sync_failed: "No se pudo actualizar el precio. Vuelve a intentarlo.",
};

/**
 * La pestaña «Precio»: lo que cobra esta edición, en pesos (Mercado Pago, en
 * Colombia) y en dólares (PayPal, fuera). Publicar exige el precio en pesos.
 * Vacío no borra: deja la moneda como estaba.
 */
const WorkshopPriceEditor = ({ slug, status, prices, legacy }: Props) => {
  const router = useRouter();
  const { toast } = useCrm();
  // Una edición heredada empieza en blanco: rellenar con el precio del paquete
  // compartido haría que cualquier guardado la moviera a uno propio sin querer.
  const startCop = legacy ? "" : prices.cop != null ? String(prices.cop) : "";
  const startUsd = legacy ? "" : prices.usd != null ? (prices.usd / 100).toFixed(2) : "";
  const [cop, setCop] = useState(startCop);
  const [usd, setUsd] = useState(startUsd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { dirty, reset: markSaved } = useDirtyBaseline(JSON.stringify([cop.trim(), usd.trim()]));
  useUnsavedChangesGuard(dirty);

  const save = async () => {
    setError(null);
    const c = cop.trim();
    const u = usd.trim();
    if ((c && (!COP_RE.test(c) || Number(c) <= 0)) || (u && (!USD_RE.test(u) || Number(u) <= 0))) {
      return setError(INVALID);
    }
    const body = {
      ...(c && c !== startCop ? { priceCop: Number(c) } : {}),
      ...(u && u !== startUsd ? { priceUsd: Number(u) } : {}),
    };
    if (Object.keys(body).length === 0) {
      markSaved();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workshops/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) return setError(data.message ?? ERRORS[data.error ?? ""] ?? "No se pudo guardar el precio.");
      markSaved();
      toast("Precio guardado");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wide">Precio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {legacy ? (
            <Alert variant="warning">
              <AlertDescription>
                Hoy cobra el precio heredado del paquete «{legacy.productTitle}»
                {legacy.priceText ? `: ${legacy.priceText}` : ""}. Escribe un precio aquí solo si quieres que este taller
                tenga el suyo.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <CrmField
              label="Precio en pesos (COP)"
              description="Se cobra con Mercado Pago en Colombia. Es el precio neto: la comisión de cobro se suma en el checkout. Hace falta para publicar."
            >
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={cop}
                onChange={(e) => setCop(e.target.value)}
                placeholder="180000"
              />
            </CrmField>
            <CrmField
              label="Precio en dólares (USD)"
              description="Se cobra con PayPal fuera de Colombia. También es el precio neto. Sin él, fuera de Colombia no se puede pagar."
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
                placeholder="45.00"
              />
            </CrmField>
          </div>
          <p className="text-xs text-muted-foreground">
            {status === "OPEN"
              ? "Está publicado: el precio nuevo se cobra desde que guardas. Quien ya pagó no cambia."
              : "Se vende solo mientras está publicado. Dejar un campo vacío no borra el precio guardado."}
          </p>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <EditionSaveBar
        dirty={dirty}
        saving={saving}
        label="Guardar precio"
        onSave={() => void save()}
        onDiscard={() => {
          setCop(startCop);
          setUsd(startUsd);
          setError(null);
          markSaved();
        }}
      />
    </div>
  );
};

export default WorkshopPriceEditor;
