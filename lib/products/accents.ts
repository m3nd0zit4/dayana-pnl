/**
 * El acento de color de una tarjeta pública.
 *
 * Nace de una petición concreta: poder darle color —o un degradado— al texto
 * de una tarjeta desde el CRM. Lo que NO hace es aceptar un color libre, y la
 * diferencia importa:
 *
 * - La web tiene siete colores y ya (`app/globals.css`). Un selector de color
 *   arbitrario deja publicar un `#ff00ff` sobre papel crema, y nada en el
 *   sistema lo impediría: renderiza, pasa el typecheck y sólo se nota cuando
 *   ya está publicado.
 *   Un conjunto cerrado convierte «personalizar» en «elegir entre cosas que
 *   sabemos que se leen».
 * - El contraste queda decidido aquí una vez. Cada acento pinta sólo el
 *   TÍTULO y el PRECIO; el cuerpo de la tarjeta sigue en tinta, porque texto
 *   corrido en degradado se lee peor y ninguna de las dos cosas mejora.
 *
 * Es la fuente única: la usan `PublicProductCard` para pintar y el editor del
 * CRM para ofrecer las opciones. Añadir un acento es añadir una entrada aquí
 * y un valor al enum de Prisma; no hay una tercera lista que actualizar.
 */

export const PRODUCT_ACCENTS = [
  {
    id: "NEUTRAL",
    label: "Tinta",
    hint: "El de siempre",
    /** Muestra del selector, en el CRM. */
    swatch: "bg-ink",
    /** Clases del título y del precio en la tarjeta pública. */
    text: "",
  },
  {
    id: "TERRACOTTA",
    label: "Terracota",
    hint: "El color de la marca",
    swatch: "bg-terracotta",
    text: "text-terracotta",
  },
  {
    id: "TERRACOTTA_GRADIENT",
    label: "Terracota degradado",
    hint: "Terracota a blush",
    swatch: "bg-gradient-to-br from-terracotta to-blush",
    text: "bg-gradient-to-r from-terracotta to-blush bg-clip-text text-transparent",
  },
  {
    id: "SAND_GRADIENT",
    label: "Arena degradado",
    hint: "Arena a terracota",
    swatch: "bg-gradient-to-br from-sand to-terracotta",
    text: "bg-gradient-to-r from-sand to-terracotta bg-clip-text text-transparent",
  },
  {
    id: "INK_GRADIENT",
    label: "Tinta degradado",
    hint: "Tinta a terracota",
    swatch: "bg-gradient-to-br from-ink to-terracotta",
    text: "bg-gradient-to-r from-ink to-terracotta bg-clip-text text-transparent",
  },
] as const;

export type ProductAccentId = (typeof PRODUCT_ACCENTS)[number]["id"];

export const DEFAULT_PRODUCT_ACCENT: ProductAccentId = "NEUTRAL";

export const PRODUCT_ACCENT_IDS = PRODUCT_ACCENTS.map((a) => a.id) as [
  ProductAccentId,
  ...ProductAccentId[],
];

const BY_ID = new Map(PRODUCT_ACCENTS.map((a) => [a.id as string, a]));

/**
 * Un acento desconocido cae en el neutro en vez de reventar: la columna
 * podría traer un valor de un despliegue más nuevo, y una tarjeta sin color
 * es infinitamente mejor que una página de producto que no carga.
 */
export const resolveProductAccent = (id: string | null | undefined) =>
  BY_ID.get(id ?? "") ?? PRODUCT_ACCENTS[0];
