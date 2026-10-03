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

/** Una pestaña del detalle. El icono lo pone `EditionTabs` según el `id`. */
export type EditionTabSpec<T extends string = string> = {
  id: T;
  label: string;
  shortLabel?: string;
  count?: number;
};
