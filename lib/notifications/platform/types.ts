import type {
  NotificationEventType,
  NotificationSeverity,
} from "@prisma/client";

/**
 * Contrato compartido entre el servidor y los clientes del feed (CRM y portal
 * de miembros). Todo lo que se envía por la red vive aquí, ya serializado:
 * las fechas viajan como ISO strings, nunca como Date.
 */

/** Un elemento del feed. `id` es el id del NotificationRecipient, no del evento. */
export type FeedItem = {
  id: string;
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  href: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, o null si sigue sin leer. */
  readAt: string | null;
};

export type FeedResponse = {
  items: FeedItem[];
  unread: number;
  /** `createdAt` ISO del último elemento; null cuando no hay más páginas. */
  nextCursor: string | null;
};

/** Carga útil de cada frame SSE. `latestAt` es epoch en milisegundos. */
export type FeedStreamEvent = {
  unread: number;
  latestAt: number;
};

export type FeedMutation =
  | { action: "read"; ids: string[] }
  | { action: "read_all" }
  | { action: "dismiss"; ids: string[] };

/**
 * A quién pertenece un feed. Se usa como parámetro discriminado en todas las
 * funciones de feed.ts para que sea imposible consultar el feed equivocado.
 */
export type FeedScope = { staffUserId: string } | { contactId: string };

export const isStaffScope = (
  scope: FeedScope
): scope is { staffUserId: string } => "staffUserId" in scope;

/** Máximo de elementos por página del feed. */
export const FEED_PAGE_SIZE = 20;

/** Tope duro de destinatarios para un envío masivo. */
export const PLATFORM_BROADCAST_MAX = 2000;

/** Tamaño de lote de `createMany` al hacer fan-out. */
export const PLATFORM_BROADCAST_CHUNK = 500;
