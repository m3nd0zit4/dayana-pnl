"use client";

import type { NotificationEventType } from "@prisma/client";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import NotificationPreferenceMatrix, {
  type PreferenceRow,
} from "./NotificationPreferenceMatrix";

/**
 * Componente autocontenido de preferencias de notificación del staff.
 *
 * Se mantiene autocontenido a propósito: la página de `/admin/ajustes/
 * mis-notificaciones` está espejada por una ruta interceptora (`@modal`) que solo
 * hace `export { default } from ...`. Si el estado viviera en la página, el
 * modal se quedaría sin él.
 */

type Props = {
  initialPreferences: PreferenceRow[];
  initialNotifyEmail: boolean;
};

const StaffNotificationPreferencesForm = ({
  initialPreferences,
  initialNotifyEmail,
}: Props) => {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [notifyEmail, setNotifyEmail] = useState(initialNotifyEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const update = (
    eventType: NotificationEventType,
    patch: { inApp?: boolean; email?: boolean }
  ) => {
    setDone(false);
    setPreferences((prev) =>
      prev.map((row) =>
        row.eventType === eventType ? { ...row, ...patch } : row
      )
    );
  };

  const save = async () => {
    setError(null);
    setSaving(true);

    try {
      // Dos endpoints distintos: el interruptor maestro vive en `StaffUser`,
      // la matriz en `StaffNotificationPreference`.
      const [masterRes, matrixRes] = await Promise.all([
        fetch("/api/admin/staff/me/notificaciones", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notifyEmail }),
        }),
        fetch("/api/admin/notifications/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences }),
        }),
      ]);

      if (!masterRes.ok || !matrixRes.ok) {
        setError("No se pudo guardar. Intenta de nuevo.");
        return;
      }

      const data = (await matrixRes.json()) as { preferences?: PreferenceRow[] };
      if (data.preferences) setPreferences(data.preferences);
      setDone(true);
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="notif-master-email">Correo</Label>
              <p className="text-sm text-muted-foreground">
                Interruptor maestro. Apagado, no recibes{" "}
                <strong>ningún</strong> correo de notificación, sin importar lo
                que marques abajo. Las alertas en la app no se ven afectadas.
              </p>
            </div>
            <Switch
              id="notif-master-email"
              checked={notifyEmail}
              disabled={saving}
              onCheckedChange={(checked) => {
                setDone(false);
                setNotifyEmail(checked);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Por evento
            </h2>
            <p className="text-sm text-muted-foreground">
              Elige qué te llega a la campana y qué además por correo. Solo se
              muestran los eventos que tu rol puede recibir.
            </p>
          </div>

          <NotificationPreferenceMatrix
            preferences={preferences}
            onChange={update}
            emailMuted={!notifyEmail}
            disabled={saving}
          />

          {!notifyEmail && (
            <p className="text-sm text-muted-foreground">
              La columna de correo está inactiva porque el interruptor maestro
              está apagado. Tus marcas se conservan.
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-sm text-emerald-600" role="status">
              Preferencias guardadas.
            </p>
          )}

          <Button type="button" disabled={saving} onClick={save}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default StaffNotificationPreferencesForm;
