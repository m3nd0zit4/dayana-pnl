import { prisma } from "../db";
import { workshopProductIdFor } from "./workshop-price-rows";

const WORKSHOP_PRODUCT_PREFIX = "taller-";

/**
 * Id actual del producto de un cobro que se inició antes de cambiar la URL
 * del taller.
 *
 * Al renombrar una edición su producto pasa de `taller-<vieja>` a
 * `taller-<nueva>`, pero la referencia firmada que viaja con el pago (PSE y
 * efectivo pueden aprobarse días después) sigue diciendo `taller-<vieja>`.
 * Sin esto el webhook no encontraba el producto: el dinero entraba y la
 * matrícula no se activaba. Cualquier otro id se devuelve tal cual, sin
 * consultar la base.
 */
export const resolveRenamedProductId = async (productId: string): Promise<string> => {
  if (!productId.startsWith(WORKSHOP_PRODUCT_PREFIX)) return productId;
  const exists = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (exists) return productId;
  const edition = await prisma.workshopEdition.findFirst({
    where: { previousSlugs: { has: productId.slice(WORKSHOP_PRODUCT_PREFIX.length) } },
    select: { slug: true },
  });
  return edition ? workshopProductIdFor(edition.slug) : productId;
};
