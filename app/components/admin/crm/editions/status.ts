/**
 * El estado de una edición (evento gratuito o taller): el mismo ciclo y las
 * mismas palabras en las dos secciones. Vive fuera de los componentes cliente
 * porque las páginas del servidor también lo leen.
 */
export type EditionStatus = "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";

export const EDITION_STATUS_LABEL: Record<EditionStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Publicado",
  CLOSED: "Inscripciones cerradas",
  COMPLETED: "Realizado",
};

/** Palabras cortas para el móvil. */
export const EDITION_STATUS_SHORT: Record<EditionStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Publicado",
  CLOSED: "Cerrado",
  COMPLETED: "Realizado",
};

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/**
 * «16 may 2026 · 07:30» para el resumen de un bloque plegado, en vez de la
 * fecha del campo tal cual («2026-05-16»). A mano y no con
 * `toLocaleDateString`: el servidor y el navegador no siempre traen el mismo
 * ICU, y un punto de diferencia («may.») rompe la hidratación.
 */
export const dateKeyLabel = (dateKey: string, timeHm?: string | null): string => {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d || !MONTHS[m - 1]) return dateKey;
  const date = `${d} ${MONTHS[m - 1]} ${y}`;
  return timeHm ? `${date} · ${timeHm}` : date;
};

/** Una pestaña del detalle. El icono lo pone `EditionTabs` según el `id`. */
export type EditionTabSpec<T extends string = string> = {
  id: T;
  label: string;
  shortLabel?: string;
  count?: number;
};
