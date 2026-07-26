import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  FEED_PAGE_SIZE,
  isStaffScope,
  type FeedItem,
  type FeedMutation,
  type FeedResponse,
  type FeedScope,
  type FeedStreamEvent,
} from "./types";

/**
 * Lectura y mutación del feed de notificaciones (campana del CRM y del portal).
 *
 * Regla que atraviesa todo el archivo: el `scope` entra en el `where` de TODAS
 * las consultas, incluidas las mutaciones. Un id de destinatario adivinado no
 * sirve de nada si no pertenece al dueño del feed.
 */

/** Fragmento de `where` derivado del scope. Nunca se construye a mano fuera de aquí. */
const scopeWhere = (
  scope: FeedScope
): { staffUserId: string } | { contactId: string } =>
  isStaffScope(scope)
    ? { staffUserId: scope.staffUserId }
    : { contactId: scope.contactId };

type RecipientRow = Prisma.NotificationRecipientGetPayload<{
  include: { notification: true };
}>;

const toFeedItem = (row: RecipientRow): FeedItem => ({
  id: row.id,
  eventType: row.notification.eventType,
  severity: row.notification.severity,
  title: row.notification.title,
  body: row.notification.body,
  href: row.notification.href,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt ? row.readAt.toISOString() : null,
});

/** Un cursor inválido se ignora en vez de reventar la petición. */
const parseCursor = (cursor?: string): Date | null => {
  if (!cursor) return null;
  const date = new Date(cursor);
  return Number.isNaN(date.getTime()) ? null : date;
};

export type ListFeedOptions = {
  /** `createdAt` ISO del último elemento de la página anterior. */
  cursor?: string;
  unreadOnly?: boolean;
};

/**
 * Una página del feed en UNA sola consulta.
 *
 * Se piden `FEED_PAGE_SIZE + 1` filas: la de más indica si hay página
 * siguiente sin necesidad de un `count` extra.
 */
export const listFeed = async (
  scope: FeedScope,
  opts: ListFeedOptions = {}
): Promise<FeedResponse> => {
  const before = parseCursor(opts.cursor);

  const rows = await prisma.notificationRecipient.findMany({
    where: {
      ...scopeWhere(scope),
      dismissedAt: null,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: FEED_PAGE_SIZE + 1,
    include: { notification: true },
  });

  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  const items = page.map(toFeedItem);

  // Si la primera página cabe entera, el contador de no leídos ya está en la
  // mano: contarlo aquí ahorra un viaje a la base de datos. En cualquier otro
  // caso (hay más páginas, o venimos con cursor) hay que preguntar.
  const unread =
    !hasMore && !before
      ? items.filter((item) => item.readAt === null).length
      : (await unreadSnapshot(scope)).unread;

  return {
    items,
    unread,
    nextCursor: hasMore
      ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
      : null,
  };
};

type SnapshotRow = {
  unread: bigint | number | null;
  latest: Date | string | number | null;
};

const toEpochMs = (value: SnapshotRow["latest"]): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

/**
 * Estado del feed en un único viaje de ida y vuelta: cuántas no leídas hay y
 * cuál es la marca de tiempo más reciente. Es lo que sondea el stream SSE cada
 * pocos segundos, así que tiene que ser una sola consulta agregada — no una
 * lista de filas que luego se cuenta en JS.
 */
export const unreadSnapshot = async (
  scope: FeedScope
): Promise<FeedStreamEvent> => {
  // Identificador de columna, no dato: es una constante del propio código.
  const column = isStaffScope(scope)
    ? Prisma.sql`staff_user_id`
    : Prisma.sql`contact_id`;
  const owner = isStaffScope(scope) ? scope.staffUserId : scope.contactId;

  const rows = await prisma.$queryRaw<SnapshotRow[]>`
    SELECT count(*) FILTER (WHERE read_at IS NULL) AS unread,
           COALESCE(max(created_at), to_timestamp(0)) AS latest
    FROM notification_recipients
    WHERE ${column} = ${owner} AND dismissed_at IS NULL
  `;

  const row = rows[0];
  // Postgres devuelve `count(*)` como bigint; Prisma lo entrega como BigInt de
  // JS, que `JSON.stringify` no sabe serializar. Coerción obligatoria.
  return {
    unread: row?.unread == null ? 0 : Number(row.unread),
    latestAt: toEpochMs(row?.latest ?? null),
  };
};

/** Marca como leídas las notificaciones indicadas. Devuelve las filas afectadas. */
export const markRead = async (
  scope: FeedScope,
  ids: string[]
): Promise<number> => {
  if (ids.length === 0) return 0;
  const result = await prisma.notificationRecipient.updateMany({
    where: { ...scopeWhere(scope), id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
};

/** Marca todo el feed como leído. Devuelve las filas afectadas. */
export const markAllRead = async (scope: FeedScope): Promise<number> => {
  const result = await prisma.notificationRecipient.updateMany({
    where: { ...scopeWhere(scope), readAt: null, dismissedAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
};

/** Descarta notificaciones (desaparecen del feed). Devuelve las filas afectadas. */
export const dismiss = async (
  scope: FeedScope,
  ids: string[]
): Promise<number> => {
  if (ids.length === 0) return 0;
  const now = new Date();
  const result = await prisma.notificationRecipient.updateMany({
    where: { ...scopeWhere(scope), id: { in: ids }, dismissedAt: null },
    // Descartar implica leído: si no, el badge seguiría contando algo que el
    // usuario ya no puede ver.
    data: { dismissedAt: now, readAt: now },
  });
  return result.count;
};

const idsSchema = z.array(z.string().min(1).max(64)).min(1).max(FEED_PAGE_SIZE * 5);

/** Valida el cuerpo de un POST al feed. Acciones desconocidas → error. */
export const feedMutationSchema: z.ZodType<FeedMutation> = z.discriminatedUnion(
  "action",
  [
    z.object({ action: z.literal("read"), ids: idsSchema }),
    z.object({ action: z.literal("read_all") }),
    z.object({ action: z.literal("dismiss"), ids: idsSchema }),
  ]
);

/** Ejecuta una mutación ya validada. Devuelve las filas afectadas. */
export const applyFeedMutation = async (
  scope: FeedScope,
  mutation: FeedMutation
): Promise<number> => {
  switch (mutation.action) {
    case "read":
      return markRead(scope, mutation.ids);
    case "read_all":
      return markAllRead(scope);
    case "dismiss":
      return dismiss(scope, mutation.ids);
  }
};
