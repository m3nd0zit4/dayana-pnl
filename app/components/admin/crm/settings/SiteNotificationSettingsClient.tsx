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
};

type Props = {
  initialConfig: Config;
  runtime: {
    enabled: boolean;
    dryRun: boolean;
    emailProvider: string | null;
  };
};

const ALL_EVENT_TYPES = Object.keys(
  NOTIFICATION_CATALOG
) as NotificationEventType[];

const SiteNotificationSettingsClient = ({ initialConfig, runtime }: Props) => {
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
      {/* ── Estado de envío (solo lectura, viene del entorno) ─────────────── */}
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Estado de envío
            </h2>
            <p className="text-sm text-muted-foreground">
              Solo lectura. Estos dos interruptores viven en las variables de
              entorno de Vercel — no se cambian desde esta pantalla.
            </p>
          </div>

          <dl className="divide-y divide-border text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <dt className="font-medium">NOTIFICATIONS_ENABLED</dt>
                <dd className="text-xs text-muted-foreground">
                  Interruptor general de envíos salientes.
                </dd>
              </div>
              <Badge variant={runtime.enabled ? "default" : "secondary"}>
                {runtime.enabled ? "Activado" : "Apagado"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <dt className="font-medium">NOTIFICATIONS_DRY_RUN</dt>
                <dd className="text-xs text-muted-foreground">
                  Modo simulado: se registra el envío pero no sale nada.
                </dd>
              </div>
              <Badge variant={runtime.dryRun ? "destructive" : "secondary"}>
                {runtime.dryRun ? "Simulación activa" : "Envío real"}
              </Badge>
            </div>
          </dl>

          {runtime.dryRun && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>No está saliendo ningún correo</AlertTitle>
              <AlertDescription>
                El modo simulado está activo. Todo se registra como si se
                hubiera enviado, pero nadie recibe nada. Fuera de producción
                viene encendido por defecto: para enviar de verdad hay que
                poner <code>NOTIFICATIONS_DRY_RUN=false</code> en Vercel.
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
