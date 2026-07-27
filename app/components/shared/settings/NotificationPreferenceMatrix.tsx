"use client";

import type { NotificationEventType } from "@prisma/client";
import {
  NOTIFICATION_CATALOG,
  groupEventTypes,
} from "@/lib/notifications/platform/catalog";
import { Switch } from "@/app/components/ui/switch";

/**
 * Matriz de preferencias por evento.
 *
 * Las filas salen del catálogo (`groupEventTypes`), nunca de una lista escrita
 * a mano: agregar un evento nuevo al catálogo lo hace aparecer aquí solo.
 */

export type PreferenceRow = {
  eventType: NotificationEventType;
  inApp: boolean;
  email: boolean;
};

type Props = {
  preferences: PreferenceRow[];
  onChange: (
    eventType: NotificationEventType,
    patch: { inApp?: boolean; email?: boolean }
  ) => void;
  /**
   * El interruptor maestro de correo está apagado: las casillas de correo se
   * siguen mostrando (no se pierde lo configurado) pero quedan inertes.
   */
  emailMuted?: boolean;
  disabled?: boolean;
};

const NotificationPreferenceMatrix = ({
  preferences,
  onChange,
  emailMuted = false,
  disabled = false,
}: Props) => {
  const byType = new Map(preferences.map((row) => [row.eventType, row]));
  const sections = groupEventTypes(preferences.map((row) => row.eventType));

  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu rol no recibe notificaciones configurables.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.group} className="space-y-1">
          <div className="flex items-end justify-between gap-4 border-b pb-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {section.group}
            </h3>
            {/* Encabezados de columna: se repiten por grupo para que sigan
                visibles al desplazarse en listas largas. */}
            <div className="flex shrink-0 gap-4 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="w-12 text-center">En la app</span>
              <span className="w-12 text-center">Correo</span>
            </div>
          </div>

          <div className="divide-y divide-border">
            {section.types.map((eventType) => {
              const row = byType.get(eventType);
              if (!row) return null;
              const entry = NOTIFICATION_CATALOG[eventType];

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

                  <div className="flex shrink-0 gap-4 pt-0.5">
                    <div className="flex w-12 justify-center">
                      <Switch
                        aria-label={`${entry.label} — en la app`}
                        checked={row.inApp}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          onChange(eventType, { inApp: checked })
                        }
                      />
                    </div>
                    <div className="flex w-12 justify-center">
                      <Switch
                        aria-label={`${entry.label} — correo`}
                        checked={row.email}
                        disabled={disabled || emailMuted}
                        onCheckedChange={(checked) =>
                          onChange(eventType, { email: checked })
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default NotificationPreferenceMatrix;
