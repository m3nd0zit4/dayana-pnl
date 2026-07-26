import { prisma } from "@/lib/db";
import { getSiteSetting } from "@/lib/crm/site-settings";

/**
 * Retención de notificaciones de plataforma.
 *
 * El feed de la campana crece para siempre si nadie lo poda: una fila por
 * destinatario y por evento. Este módulo borra lo viejo en páginas acotadas —
 * nunca un `deleteMany` sin límite, porque contra Neon serverless una sola
 * sentencia que toque cientos de miles de filas agota el tiempo de la función y
 * deja la transacción a medias.
 *
 * ── Claves de `SiteSetting` (todas en días, enteros positivos) ──────────────
 *
 * | Clave                                     | Def. | Qué borra                                   |
 * |-------------------------------------------|------|---------------------------------------------|
 * | `notification_retention_dismissed_days`   |  30  | NotificationRecipient descartados           |
 * | `notification_retention_read_days`        |  90  | NotificationRecipient leídos                |
 * | `notification_retention_unread_days`      | 180  | NotificationRecipient sin leer ni descartar |
 * | `notification_retention_notification_days`| 180  | PlatformNotification (arrastra en cascada)  |
 * | `notification_retention_delivery_days`    | 365  | NotificationDelivery (ver interruptor)      |
 *
 * Un valor inválido (no numérico, ≤ 0, > 3650) se ignora y se usa el default,
 * para que un dedazo en la UI de ajustes no borre historia reciente.
 *
 * ── Interruptor de env ─────────────────────────────────────────────────────
 *
 * `NOTIFICATIONS_PRUNE_DELIVERIES=true` habilita la poda de
 * `NotificationDelivery`. Está apagada por defecto a propósito: esa tabla es el
 * registro de auditoría de envíos y borrarla es una decisión del dueño, no un
 * efecto secundario de desplegar este cron.
 */

/** Filas por página. Un `IN (...)` de este tamaño va sobrado en Postgres. */
const PAGE_SIZE = 5000;
/** Tope de páginas por regla y corrida: 50.000 filas máximo, y mañana sigue. */
const MAX_PAGES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Máximo aceptable para una ventana configurada (10 años). */
const MAX_RETENTION_DAYS = 3650;

export const NOTIFICATION_RETENTION_RULES = [
  "dismissedRecipients",
  "readRecipients",
  "unreadRecipients",
  "notifications",
  "deliveries",
] as const;

export type NotificationRetentionRule =
  (typeof NOTIFICATION_RETENTION_RULES)[number];

const RULE_SETTINGS: Record<
  NotificationRetentionRule,
  { key: string; defaultDays: number }
> = {
  dismissedRecipients: {
    key: "notification_retention_dismissed_days",
    defaultDays: 30,
  },
  readRecipients: {
    key: "notification_retention_read_days",
    defaultDays: 90,
  },
  unreadRecipients: {
    key: "notification_retention_unread_days",
    defaultDays: 180,
  },
  notifications: {
    key: "notification_retention_notification_days",
    defaultDays: 180,
  },
  deliveries: {
    key: "notification_retention_delivery_days",
    defaultDays: 365,
  },
};

const parseDays = (raw: string | null, fallback: number): number => {
  if (raw == null) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > MAX_RETENTION_DAYS) return fallback;
  return Math.round(n);
};

/** Fecha de corte de una regla: todo lo anterior es candidato a borrarse. */
const cutoffFor = async (rule: NotificationRetentionRule): Promise<Date> => {
  const { key, defaultDays } = RULE_SETTINGS[rule];
  let raw: string | null = null;
  try {
    raw = await getSiteSetting(key);
  } catch {
    /* Ajuste no disponible: se usa el default. */
  }
  return new Date(Date.now() - parseDays(raw, defaultDays) * DAY_MS);
};

export const isDeliveryPruneEnabled = (): boolean =>
  process.env.NOTIFICATIONS_PRUNE_DELIVERIES === "true";

type IdRow = { id: string };

/**
 * Borra en páginas: selecciona ids, borra por id, repite. Corta en cuanto una
 * página vuelve incompleta (ya no queda nada viejo) o al llegar al tope.
 */
const deleteInPages = async (
  fetchPage: (take: number) => Promise<IdRow[]>,
  deletePage: (ids: string[]) => Promise<number>
): Promise<number> => {
  let deleted = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await fetchPage(PAGE_SIZE);
    if (rows.length === 0) break;
    deleted += await deletePage(rows.map((row) => row.id));
    if (rows.length < PAGE_SIZE) break;
  }
  return deleted;
};

const pruneRecipients = async (
  where: Record<string, unknown>
): Promise<number> =>
  deleteInPages(
    (take) =>
      prisma.notificationRecipient.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    async (ids) => {
      const result = await prisma.notificationRecipient.deleteMany({
        where: { id: { in: ids } },
      });
      return result.count;
    }
  );

/** Ejecuta una sola regla. El cron le da un `step.run` propio a cada una. */
export const runNotificationRetentionRule = async (
  rule: NotificationRetentionRule
): Promise<number> => {
  const cutoff = await cutoffFor(rule);

  switch (rule) {
    case "dismissedRecipients":
      return pruneRecipients({ dismissedAt: { not: null, lt: cutoff } });

    case "readRecipients":
      return pruneRecipients({
        dismissedAt: null,
        readAt: { not: null, lt: cutoff },
      });

    // Sin leer y sin descartar: si no se podan, viven para siempre.
    case "unreadRecipients":
      return pruneRecipients({
        readAt: null,
        dismissedAt: null,
        createdAt: { lt: cutoff },
      });

    // La cascada de `notification_id` limpia los destinatarios rezagados.
    case "notifications":
      return deleteInPages(
        (take) =>
          prisma.platformNotification.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            orderBy: { createdAt: "asc" },
            take,
          }),
        async (ids) => {
          const result = await prisma.platformNotification.deleteMany({
            where: { id: { in: ids } },
          });
          return result.count;
        }
      );

    case "deliveries": {
      if (!isDeliveryPruneEnabled()) return 0;
      return deleteInPages(
        (take) =>
          prisma.notificationDelivery.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            orderBy: { createdAt: "asc" },
            take,
          }),
        async (ids) => {
          const result = await prisma.notificationDelivery.deleteMany({
            where: { id: { in: ids } },
          });
          return result.count;
        }
      );
    }

    default:
      return 0;
  }
};

/**
 * Corre todas las reglas en orden y devuelve cuántas filas borró cada una.
 *
 * El orden importa poco pero no es casual: primero los destinatarios (lo más
 * numeroso), luego las notificaciones huérfanas, y al final los envíos.
 */
export const runNotificationRetention = async (): Promise<
  Record<string, number>
> => {
  const result: Record<string, number> = {};
  for (const rule of NOTIFICATION_RETENTION_RULES) {
    result[rule] = await runNotificationRetentionRule(rule);
  }
  return result;
};
