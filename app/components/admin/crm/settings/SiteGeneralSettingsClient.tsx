"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import TimezoneSelect from "@/app/components/admin/crm/TimezoneSelect";

type RateSource = "crm" | "env_or_default";

type Props = {
  initialRate: number;
  initialSource: RateSource;
  operationalTimezone: string;
  publicSiteUrl: string;
};

const SiteGeneralSettingsClient = ({
  initialRate,
  initialSource,
  operationalTimezone: initialTz,
  publicSiteUrl,
}: Props) => {
  const [rate, setRate] = useState(String(initialRate));
  const [source, setSource] = useState<RateSource>(initialSource);
  const [timezone, setTimezone] = useState(initialTz);
  const [savingRate, setSavingRate] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneRate, setDoneRate] = useState(false);
  const [doneTz, setDoneTz] = useState(false);

  const saveRate = async () => {
    setError(null);
    setDoneRate(false);
    setSavingRate(true);

    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usdToCopRate: Number(rate) }),
      });
      const data = (await res.json()) as {
        usdToCopRate?: number;
        source?: RateSource;
        error?: string;
      };

      if (!res.ok) {
        setError(
          data.error === "invalid_rate"
            ? "Tasa inválida. Usa un número mayor que cero."
            : "No se pudo guardar. Intenta de nuevo."
        );
        return;
      }

      if (data.usdToCopRate != null) setRate(String(data.usdToCopRate));
      if (data.source) setSource(data.source);
      setDoneRate(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    } finally {
      setSavingRate(false);
    }
  };

  const saveTimezone = async () => {
    setError(null);
    setDoneTz(false);
    setSavingTz(true);
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationalTimezone: timezone }),
      });
      const data = (await res.json()) as {
        operationalTimezone?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error === "invalid_timezone"
            ? "Zona horaria inválida."
            : "No se pudo guardar la zona horaria."
        );
        return;
      }
      if (data.operationalTimezone) setTimezone(data.operationalTimezone);
      setDoneTz(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    } finally {
      setSavingTz(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Zona horaria del CRM
            </h2>
            <p className="text-sm text-muted-foreground">
              Al crear webinars, talleres, clases o eventos, las fechas y horas
              que escribes se interpretan en esta zona y se guardan en UTC. En
              la web, el portal y los correos cada persona ve su hora local.
            </p>
          </div>

          <div className="max-w-md space-y-3">
            <TimezoneSelect
              id="operational-timezone"
              label="Zona operativa"
              value={timezone}
              onChange={(tz) => {
                setDoneTz(false);
                setTimezone(tz);
              }}
              required
            />
            <p className="text-xs text-muted-foreground">
              Valor actual: <span className="font-mono">{timezone}</span>
            </p>
          </div>

          {doneTz && (
            <p className="text-sm text-emerald-600" role="status">
              Zona horaria actualizada.
            </p>
          )}

          <Button
            type="button"
            disabled={savingTz || timezone === initialTz}
            onClick={() => void saveTimezone()}
          >
            {savingTz ? "Guardando…" : "Guardar zona horaria"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tasa de cambio
            </h2>
            <p className="text-sm text-muted-foreground">
              Cuántos pesos colombianos vale un dólar. Se usa para convertir los
              precios en USD cuando el visitante paga en COP.
            </p>
          </div>

          <div className="max-w-xs space-y-2">
            <Label htmlFor="usd-to-cop">COP por 1 USD</Label>
            <Input
              id="usd-to-cop"
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={rate}
              disabled={savingRate}
              onChange={(e) => {
                setDoneRate(false);
                setRate(e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {source === "crm"
                ? "Valor definido aquí, en el CRM."
                : "Valor heredado de la variable de entorno (o el respaldo de 3500). Al guardar pasa a definirse aquí."}
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {doneRate && (
            <p className="text-sm text-emerald-600" role="status">
              Tasa actualizada.
            </p>
          )}

          <Button type="button" disabled={savingRate} onClick={() => void saveRate()}>
            {savingRate ? "Guardando…" : "Guardar tasa"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Datos del sitio
            </h2>
            <p className="text-sm text-muted-foreground">
              Valores de solo lectura. Se cambian en el código o en las
              variables de entorno de Vercel, no desde aquí.
            </p>
          </div>

          <dl className="divide-y divide-border text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <dt className="text-muted-foreground">URL pública</dt>
              <dd className="font-mono break-all">{publicSiteUrl}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
};

export default SiteGeneralSettingsClient;
