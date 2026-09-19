/**
 * Forma válida de la URL de un taller (`/taller-virtual/<slug>`): minúsculas,
 * números y guiones, sin empezar ni terminar en guion, de 3 a 120 caracteres.
 * Pura, para probarla sin base de datos.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,118})[a-z0-9]$/;

export const isValidWorkshopSlug = (slug: string): boolean =>
  SLUG_RE.test(slug) && !slug.includes("--");

/** Normaliza lo que escribe el equipo: tildes fuera, espacios a guiones. */
export const normalizeWorkshopSlug = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
