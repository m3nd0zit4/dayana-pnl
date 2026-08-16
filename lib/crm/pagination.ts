/**
 * Paginación keyset compartida.
 *
 * Cada sección se inventaba la suya y dos de las tres estaban mal:
 * `conversations.ts` usa el `cursor` de Prisma, `feed.ts` compara
 * `createdAt < before` **sin desempate** (pierde filas que comparten
 * timestamp) y `contacts.ts` filtraba por `id < cursor` mientras ordenaba por
 * `(createdAt desc, id desc)` — que no es un keyset válido: salta y repite
 * filas. Aquí está una sola vez.
 *
 * Por qué keyset y no `skip`: `OFFSET 90000` obliga a Postgres a materializar
 * y descartar 90.000 filas. Y con `ORDER BY created_at DESC`, donde los
 * contactos nuevos entran por la cabeza, cada alta durante la navegación
 * desplaza la ventana y duplica una fila en la página siguiente. El keyset es
 * inmune a las dos cosas.
 */

/** Tamaño de página por defecto en el CRM. */
export const PAGE_SIZE = 50;

/** Techo duro: ninguna ruta acepta un `limit` arbitrario del cliente. */
export const MAX_PAGE_SIZE = 100;

export type Page<T> = {
  items: T[];
  /** `null` cuando no quedan más filas. */
  nextCursor: string | null;
};

export type KeysetCursor = { at: Date; id: string };

/**
 * Cursor opaco y seguro en URL: base64url(`${epochMs}:${id}`).
 *
 * Codifica la clave de orden, no solo el id — eso es lo que lo hace
 * reutilizable para `lastMessageAt` (bandeja) o `updatedAt` (terapias) sin un
 * formato distinto por sección.
 */
export const encodeCursor = (at: Date, id: string): string =>
  Buffer.from(`${at.getTime()}:${id}`).toString("base64url");

export const decodeCursor = (raw?: string | null): KeysetCursor | null => {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep <= 0) return null;
    const ms = Number(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (!Number.isFinite(ms) || !id) return null;
    return { at: new Date(ms), id };
  } catch {
    // Un cursor manipulado no debe tirar la página: se ignora y se sirve la
    // primera.
    return null;
  }
};

/**
 * Predicado keyset como `OR` de dos ramas.
 *
 * La comparación de tuplas `(a, b) < (?, ?)` no es expresable en el DSL de
 * Prisma, y el `cursor` de Prisma toma un campo **único** e infiere la
 * comparación del `orderBy` — los cursores compuestos son función de la v8. La
 * forma explícita es demostrablemente correcta hoy.
 */
export const keysetWhere = (
  field: string,
  cursor: KeysetCursor,
  dir: "asc" | "desc" = "desc"
): Record<string, unknown> => {
  const op = dir === "desc" ? "lt" : "gt";
  return {
    OR: [
      { [field]: { [op]: cursor.at } },
      { [field]: cursor.at, id: { [op]: cursor.id } },
    ],
  };
};

/**
 * Convierte un `findMany` de `take + 1` filas en una página.
 *
 * Se pide una fila de más para saber si hay siguiente sin pagar un `count`
 * aparte; esa fila se descarta y el cursor sale de la última que sí se
 * devuelve.
 */
export const splitPage = <T>(
  rows: T[],
  take: number,
  cursorOf: (row: T) => string
): Page<T> => {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? cursorOf(last) : null,
  };
};

/** Acota el `limit` que llega del cliente. */
export const clampTake = (
  raw: unknown,
  fallback: number = PAGE_SIZE,
  max: number = MAX_PAGE_SIZE
): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
};
