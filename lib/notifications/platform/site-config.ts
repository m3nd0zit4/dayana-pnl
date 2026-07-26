import type { NotificationEventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NOTIFICATION_CATALOG } from "./catalog";

/**
 * Accesores tipados sobre la KV `SiteSetting` para los ajustes de
 * notificaciones a nivel de sitio.
 *
 * `SiteSetting` es una tabla `key/value` de texto plano: sin esta capa cada
 * lector reimplementa su propio parseo y sus propios defaults, y basta un
 * dedazo en la UI para dejar un valor que nadie valida. Aquí se centraliza el
 * parseo, el recorte a rango y el default.
 *
 * ⚠️ Los defaults y el rango de retención **espejan** `retention.ts` (1..3650
 * días, defaults 30/90/180/180/365). Ese módulo es el que realmente poda, y no
 * exporta su tabla; si cambias un default allá, cámbialo aquí también o la UI
 * mostrará un número que no es el que se aplica.
 */

export const RETENTION_SETTING_KEYS = {
  dismissedDays: "notification_retention_dismissed_days",
  readDays: "notification_retention_read_days",
  unreadDays: "notification_retention_unread_days",
  notificationDays: "notification_retention_notification_days",
  deliveryDays: "notification_retention_delivery_days",
} as const;

export type RetentionSettingField = keyof typeof RETENTION_SETTING_KEYS;

export const RETENTION_DEFAULTS: Record<RetentionSettingField, number> = {
  dismissedDays: 30,
  readDays: 90,
  unreadDays: 180,
  notificationDays: 180,
  deliveryDays: 365,
};

/** Etiquetas para la UI. Mismo orden en el que se aplican las reglas. */
export const RETENTION_FIELDS: {
  field: RetentionSettingField;
  label: string;
  description: string;
}[] = [
  {
    field: "dismissedDays",
    label: "Descartadas",
    description: "Días que se conservan las notificaciones que alguien descartó.",
  },
  {
    field: "readDays",
    label: "Leídas",
    description: "Días que se conservan las notificaciones ya leídas.",
  },
  {
    field: "unreadDays",
    label: "Sin leer",
    description: "Días que se conservan las notificaciones que nadie abrió.",
  },
  {
    field: "notificationDays",
    label: "Notificaciones",
    description:
      "Días que se conserva la notificación completa. Al borrarse arrastra a sus destinatarios.",
  },
  {
    field: "deliveryDays",
    label: "Registro de envíos",
    description:
      "Días que se conserva el historial de correos, SMS y WhatsApp. Solo se poda si NOTIFICATIONS_PRUNE_DELIVERIES=true.",
  },
];

/** Eventos apagados para todo el sitio, sin importar preferencias personales. */
export const DISABLED_EVENT_TYPES_KEY = "notification_disabled_event_types";

/** Correo que recibe copia de las alertas de staff. */
export const STAFF_ALERT_INBOX_KEY = "notification_staff_alert_inbox";

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export type NotificationSiteConfig = {
  retention: Record<RetentionSettingField, number>;
  /** Valores que vienen de una fila guardada (no del default). */
  retentionOverridden: Record<RetentionSettingField, boolean>;
  disabledEventTypes: NotificationEventType[];
  staffAlertInbox: string | null;
};

/** Recorta a rango; un valor inválido cae al default, igual que en `retention.ts`. */
export const parseRetentionDays = (
  raw: string | null | undefined,
  fallback: number
): number => {
  if (raw == null) return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < MIN_RETENTION_DAYS || n > MAX_RETENTION_DAYS) {
    return fallback;
  }
  return Math.round(n);
};

const isKnownEventType = (value: string): value is NotificationEventType =>
  Object.hasOwn(NOTIFICATION_CATALOG, value);

/**
 * Los eventos apagados se guardan como CSV. Se descartan los que ya no existen
 * en el catálogo para que renombrar un evento no deje basura que la UI no
 * sepa dibujar.
 */
export const parseDisabledEventTypes = (
  raw: string | null | undefined
): NotificationEventType[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(isKnownEventType);
};

const serializeDisabledEventTypes = (
  types: readonly string[]
): string =>
  Array.from(new Set(types.filter(isKnownEventType))).join(",");

export const getNotificationSiteConfig =
  async (): Promise<NotificationSiteConfig> => {
    const keys = [
      ...Object.values(RETENTION_SETTING_KEYS),
      DISABLED_EVENT_TYPES_KEY,
      STAFF_ALERT_INBOX_KEY,
    ];

    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    const retention = {} as Record<RetentionSettingField, number>;
    const retentionOverridden = {} as Record<RetentionSettingField, boolean>;
    for (const field of Object.keys(
      RETENTION_SETTING_KEYS
    ) as RetentionSettingField[]) {
      const raw = byKey.get(RETENTION_SETTING_KEYS[field]) ?? null;
      retention[field] = parseRetentionDays(raw, RETENTION_DEFAULTS[field]);
      retentionOverridden[field] = raw != null;
    }

    const inbox = byKey.get(STAFF_ALERT_INBOX_KEY)?.trim();

    return {
      retention,
      retentionOverridden,
      disabledEventTypes: parseDisabledEventTypes(
        byKey.get(DISABLED_EVENT_TYPES_KEY)
      ),
      staffAlertInbox: inbox ? inbox : null,
    };
  };

export type NotificationSiteConfigPatch = {
  retention?: Partial<Record<RetentionSettingField, number>>;
  disabledEventTypes?: string[];
  /** `null` o cadena vacía borra el override. */
  staffAlertInbox?: string | null;
};

/**
 * Guarda solo las claves presentes en el patch. Un `upsert` por clave dentro de
 * una transacción: son cinco filas como mucho, y así un valor malo no deja la
 * mitad de los ajustes escritos.
 */
export const setNotificationSiteConfig = async (
  patch: NotificationSiteConfigPatch
): Promise<void> => {
  const writes: { key: string; value: string }[] = [];

  if (patch.retention) {
    for (const [field, value] of Object.entries(patch.retention) as [
      RetentionSettingField,
      number | undefined,
    ][]) {
      if (value == null) continue;
      writes.push({
        key: RETENTION_SETTING_KEYS[field],
        value: String(parseRetentionDays(String(value), RETENTION_DEFAULTS[field])),
      });
    }
  }

  if (patch.disabledEventTypes) {
    writes.push({
      key: DISABLED_EVENT_TYPES_KEY,
      value: serializeDisabledEventTypes(patch.disabledEventTypes),
    });
  }

  if (patch.staffAlertInbox !== undefined) {
    writes.push({
      key: STAFF_ALERT_INBOX_KEY,
      value: patch.staffAlertInbox?.trim() ?? "",
    });
  }

  if (writes.length === 0) return;

  await prisma.$transaction(
    writes.map((row) =>
      prisma.siteSetting.upsert({
        where: { key: row.key },
        create: { key: row.key, value: row.value },
        update: { value: row.value },
      })
    )
  );
};

/**
 * Punto de enganche para la capa de emisión.
 *
 * ⚠️ Hoy **nadie lo llama**: `emit.ts` todavía no consulta el apagado global.
 * Se aplica en `emitPlatformNotification`, que consulta esto antes de resolver
 * destinatarios: un evento apagado no crea fila ni reparte correo.
 */
export const isEventTypeGloballyDisabled = async (
  eventType: NotificationEventType
): Promise<boolean> => {
  const raw = await prisma.siteSetting.findUnique({
    where: { key: DISABLED_EVENT_TYPES_KEY },
    select: { value: true },
  });
  return parseDisabledEventTypes(raw?.value).includes(eventType);
};
