import { ProductAccent } from "@prisma/client";

/**
 * El color del título y del precio de una tarjeta de producto.
 *
 * **Es una lista cerrada y no un selector de color libre.** La web tiene siete
 * colores; un color arbitrario deja publicar un título ilegible sobre el papel
 * crema sin que nada lo impida hasta que ya está en producción. Cerrando la
 * lista, lo peor que puede pasar es que quede feo — nunca invisible.
 *
 * Y es **una sola lista, no dos**: de aquí salen tanto las muestras que pinta
 * el panel como las clases que aplica la tarjeta pública. Separarlas era la
 * forma segura de que el botón enseñara un color y la web pintara otro.
 *
 * El id es el valor del enum de Prisma a propósito. Así lo que se guarda en la
 * base y lo que se elige en el panel no pueden divergir, y añadir un acento es
 * una migración más una entrada aquí, en ese orden.
 */
export type ProductAccentId = ProductAccent;

export type ProductAccentDef = {
  id: ProductAccentId;
  /** Lo que lee quien elige en el panel. */
  label: string;
  /** Ayuda corta del botón: cuándo usarlo. */
  hint: string;
  /** Clases de la muestra redonda del panel. */
  swatch: string;
  /**
   * Clases del título y del precio en la tarjeta pública. Los degradados se
   * pintan sobre el texto con `bg-clip-text`, así que necesitan
   * `text-transparent` — sin él el degradado queda detrás de un texto opaco y
   * no se ve nada.
   */
  titleClass: string;
};

export const PRODUCT_ACCENTS: readonly ProductAccentDef[] = [
  {
    id: "NEUTRAL",
    label: "Neutro",
    hint: "Tinta sobre papel. El de siempre.",
    swatch: "bg-ink",
    titleClass: "",
  },
  {
    id: "TERRACOTTA",
    label: "Terracota",
    hint: "El color de marca. Destaca sin gritar.",
    swatch: "bg-terracotta",
    titleClass: "text-terracotta",
  },
  {
    id: "TERRACOTTA_GRADIENT",
    label: "Terracota degradado",
    hint: "Para el paquete que se quiere vender primero.",
    swatch: "bg-gradient-to-br from-terracotta to-blush",
    titleClass:
      "bg-gradient-to-br from-terracotta to-blush bg-clip-text text-transparent",
  },
  {
    id: "SAND_GRADIENT",
    label: "Arena degradado",
    hint: "Cálido y discreto. Para los paquetes largos.",
    swatch: "bg-gradient-to-br from-sand to-linen",
    titleClass:
      "bg-gradient-to-br from-sand to-linen bg-clip-text text-transparent",
  },
  {
    id: "INK_GRADIENT",
    label: "Tinta degradado",
    hint: "Sobrio. Para formación y talleres.",
    swatch: "bg-gradient-to-br from-ink to-sand",
    titleClass:
      "bg-gradient-to-br from-ink to-sand bg-clip-text text-transparent",
  },
];

export const DEFAULT_PRODUCT_ACCENT: ProductAccentId = "NEUTRAL";

const BY_ID = new Map<string, ProductAccentDef>(
  PRODUCT_ACCENTS.map((a) => [a.id, a]),
);

/**
 * Nunca lanza y nunca devuelve `undefined`.
 *
 * Un producto sembrado antes de que existiera el acento trae `null`, y uno
 * guardado con un valor retirado del enum trae algo que ya no está en la
 * lista. En los dos casos la tarjeta tiene que pintarse igual: el acento es
 * decoración, y quedarse sin título por un color es peor que el color.
 */
export function resolveProductAccent(
  value: ProductAccentId | string | null | undefined,
): ProductAccentDef {
  return (
    (value ? BY_ID.get(value) : undefined) ??
    BY_ID.get(DEFAULT_PRODUCT_ACCENT)!
  );
}
