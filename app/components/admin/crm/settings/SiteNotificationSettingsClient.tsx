"use client";

import type { NotificationEventType } from "@prisma/client";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import {
  NOTIFICATION_CATALOG,
  groupEventTypes,
} from "@/lib/notifications/platform/catalog";
import {
  RETENTION_FIELDS,
  type RetentionSettingField,
} from "@/lib/notifications/platform/site-config";

type Retention = Record<RetentionSettingField, number>;

type Config = {
  retention: Retention;
  disabledEventTypes: NotificationEventType[];
  staffAlertInbox: string | null;
  /** `null` = automático (usa el entorno). */
  enabledOverride: boolean | null;
  dryRunOverride: boolean | null;
};

type Props = {
  initialConfig: Config;
  runtime: {
    enabled: boolean;
    dryRun: boolean;
    emailProvider: string | null;
  };
  /** Valor crudo de `NOTIFICATIONS_ENABLED`/`NOTIFICATIONS_DRY_RUN`, sin fusionar con el override. */
  envFloor: { enabled: boolean; dryRun: boolean };
};

const ALL_EVENT_TYPES = Object.keys(
  NOTIFICATION_CATALOG
) as NotificationEventType[];

const SiteNotificationSettingsClient = ({
  initialConfig,
  envFloor,
}: Props) => {
  const [retention, setRetention] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialConfig.retention).map(([k, v]) => [k, String(v)])
    )
  );
  const [disabled, setDisabled] = useState<Set<NotificationEventType>>(
    () => new Set(initialConfig.disabledEventTypes)
  );
  const [inbox, setInbox] = useState(initialConfig.staffAlertInbox ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(
    initialConfig.enabledOverride
  );
  const [dryRunOverride, setDryRunOverride] = useState<boolean | null>(
    initialConfig.dryRunOverride
  );
  const [overrideBusy, setOverrideBusy] = useState<
    "enabled" | "dryRun" | null
  >(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const effectiveEnabled = enabledOverride ?? envFloor.enabled;
  const effectiveDryRun = dryRunOverride ?? envFloor.dryRun;

  const patchOverride = async (
    field: "enabledOverride" | "dryRunOverride",
    value: boolean | null
  ) => {
    setOverrideError(null);
    setOverrideBusy(field === "enabledOverride" ? "enabled" : "dryRun");
    try {
      const res = await fetch("/api/admin/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        setOverrideError("No se pudo actualizar. Intenta de nuevo.");
        return;
      }
      if (field === "enabledOverride") setEnabledOverride(value);
      else setDryRunOverride(value);
    } catch {
      setOverrideError("No se pudo contactar con el servidor.");
    } finally {
      setOverrideBusy(null);
    }
  };

  const sections = groupEventTypes(ALL_EVENT_TYPES);

  const toggleEvent = (eventType: NotificationEventType, enabled: boolean) => {
    setDone(false);
    setDisabled((prev) => {
      const next = new Set(prev);
      if (enabled) next.delete(eventType);
      else next.add(eventType);
      return next;
    });
  };

  const save = async () => {
    setError(null);
    setDone(false);
    setSaving(true);

    try {
      const res = await fetch("/api/admin/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retention: Object.fromEntries(
            Object.entries(retention).map(([k, v]) => [k, Number(v)])
          ),
          disabledEventTypes: Array.from(disabled),
          staffAlertInbox: inbox.trim() === "" ? "" : inbox.trim(),
        }),
      });

      if (!res.ok) {
        setError(
          res.status === 400
            ? "Revisa los valores: los días deben estar entre 1 y 3650 y el correo debe ser válido."
            : "No se pudo guardar. Intenta de nuevo."
        );
        return;
      }
      setDone(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Estado de envío ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Estado de envío
            </h2>
            <p className="text-sm text-muted-foreground">
              Por defecto siguen la variable de entorno de Vercel, pero se
              pueden forzar desde aquí sin redeploy. &quot;Automático&quot;
              quiere decir que no hay override guardado en la base de datos.
            </p>
          </div>

          {overrideError && (
            <p className="text-sm text-destructive" role="alert">
              {overrideError}
            </p>
          )}

          <dl className="divide-y divide-border text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-0.5">
                <dt className="font-medium">NOTIFICATIONS_ENABLED</dt>
                <dd className="text-xs text-muted-foreground">
                  Interruptor general de envíos salientes.
                </dd>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    Entorno: {envFloor.enabled ? "Activado" : "Apagado"}
                  </Badge>
                  <Badge variant={enabledOverride == null ? "outline" : "default"}>
                    {enabledOverride == null
                      ? "Automático"
                      : enabledOverride
                        ? "Forzado: activado"
                        : "Forzado: apagado"}
                  </Badge>
                  <Switch
                    aria-label="NOTIFICATIONS_ENABLED"
                    checked={effectiveEnabled}
                    disabled={overrideBusy === "enabled"}
                    onCheckedChange={(checked) =>
                      void patchOverride("enabledOverride", Boolean(checked))
                    }
                  />
                </div>
                {enabledOverride != null && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    disabled={overrideBusy === "enabled"}
                    onClick={() => void patchOverride("enabledOverride", null)}
                  >
                    Restablecer a automático
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-0.5">
                <dt className="font-medium">NOTIFICATIONS_DRY_RUN</dt>
                <dd className="text-xs text-muted-foreground">
                  Modo simulado: se registra el envío pero no sale nada.
                </dd>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    Entorno: {envFloor.dryRun ? "Simulación" : "Envío real"}
                  </Badge>
                  <Badge variant={dryRunOverride == null ? "outline" : "default"}>
                    {dryRunOverride == null
                      ? "Automático"
                      : dryRunOverride
                        ? "Forzado: simulación"
                        : "Forzado: envío real"}
                  </Badge>
                  <Switch
                    aria-label="NOTIFICATIONS_DRY_RUN"
                    checked={effectiveDryRun}
                    disabled={overrideBusy === "dryRun"}
                    onCheckedChange={(checked) =>
                      void patchOverride("dryRunOverride", Boolean(checked))
                    }
                  />
                </div>
                {dryRunOverride != null && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    disabled={overrideBusy === "dryRun"}
                    onClick={() => void patchOverride("dryRunOverride", null)}
                  >
                    Restablecer a automático
                  </button>
                )}
              </div>
            </div>
          </dl>

          {effectiveDryRun && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>No está saliendo ningún correo</AlertTitle>
              <AlertDescription>
                El modo simulado está activo. Todo se registra como si se
                hubiera enviado, pero nadie recibe nada.
                {dryRunOverride == null
                  ? " Fuera de producción viene encendido por defecto: para enviar de verdad hay que poner NOTIFICATIONS_DRY_RUN=false en Vercel, o forzarlo arriba."
                  : " Está forzado desde esta pantalla — usa \"Restablecer a automático\" para volver al valor del entorno."}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Bandeja de alertas ────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Bandeja de alertas del staff
            </h2>
            <p className="text-sm text-muted-foreground">
              Correo que recibe copia de las alertas del equipo. Déjalo vacío
              para que cada quien reciba en su propio correo.
            </p>
          </div>

          <div className="max-w-md space-y-2">
            <Label htmlFor="staff-alert-inbox">Correo de alertas</Label>
            <Input
              id="staff-alert-inbox"
              type="email"
              placeholder="alertas@dayanabeltran.com"
              value={inbox}
              disabled={saving}
              onChange={(e) => {
                setDone(false);
                setInbox(e.target.value);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Retención ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Retención
            </h2>
            <p className="text-sm text-muted-foreground">
              Cuántos días se conserva cada cosa antes de que la limpieza
              automática la borre. Entre 1 y 3650 días.
            </p>
          </div>

          <div className="divide-y divide-border">
            {RETENTION_FIELDS.map(({ field, label, description }) => (
              <div
                key={field}
                className="flex flex-wrap items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0 max-w-md space-y-0.5">
                  <Label htmlFor={`retention-${field}`}>{label}</Label>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    id={`retention-${field}`}
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    className="w-24"
                    value={retention[field] ?? ""}
                    disabled={saving}
                    onChange={(e) => {
                      setDone(false);
                      setRetention((prev) => ({
                        ...prev,
                        [field]: e.target.value,
                      }));
                    }}
                  />
                  <span className="text-xs text-muted-foreground">días</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Eventos apagados globalmente ──────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Eventos activos
            </h2>
            <p className="text-sm text-muted-foreground">
              Apagar un evento aquí lo silencia para todo el sitio, por encima
              de las preferencias personales de cada persona.
            </p>
          </div>

          <div className="space-y-6">
            {sections.map((section) => (
              <section key={section.group} className="space-y-1">
                <h3 className="border-b pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {section.group}
                </h3>
                <div className="divide-y divide-border">
                  {section.types.map((eventType) => {
                    const entry = NOTIFICATION_CATALOG[eventType];
                    const enabled = !disabled.has(eventType);
                    return (
                      <div
                        key={eventType}
                        className="flex items-start justify-between gap-4 py-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-medium">{entry.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.description}
                          </p>
                        </div>
                        <Switch
                          aria-label={entry.label}
                          checked={enabled}
                          disabled={saving}
                          onCheckedChange={(checked) =>
                            toggleEvent(eventType, checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="text-sm text-emerald-600" role="status">
            Ajustes guardados.
          </p>
        )}
        <Button type="button" disabled={saving} onClick={save}>
          {saving ? "Guardando…" : "Guardar ajustes"}
        </Button>
      </div>
    </div>
  );
};

export default SiteNotificationSettingsClient;
