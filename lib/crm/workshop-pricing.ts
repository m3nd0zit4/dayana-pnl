import { EnrollmentStatus, ProductKind, WorkshopEditionStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

import {
  workshopPriceRowsToWrite,
  workshopProductIdFor,
  type WorkshopPriceInput,
} from "./workshop-price-rows";

/**
 * Precio por edición de taller.
 *
 * Antes todas las ediciones colgaban de un único producto «Taller» con un
 * precio fijo: se cobraba ese precio fuera cual fuera la edición abierta, y
 * el pago no quedaba ligado a ninguna edición. Ahora cada edición tiene su
 * propio producto (`taller-<slug>`) con sus precios, y todo el checkout
 * —PayPal, Mercado Pago, webhooks, enlaces de pago— lo cobra sin cambios,
 * porque ya sabe cobrar un producto.
 *
 * Este módulo sólo toca productos `taller-<slug>`. Un producto compartido
 * heredado (p. ej. `workshop-virtual`) nunca se activa, desactiva ni reprecia
 * desde aquí: podría estar vendiendo otra edición.
 */

export type SyncWorkshopPriceInput = WorkshopPriceInput & {
  slug: string;
  title: string;
  status: WorkshopEditionStatus;
};

/**
 * Crea o actualiza el producto propio de la edición con sus precios y lo
 * enlaza. Devuelve el id del producto cobrable de la edición (el propio o,
 * si no tiene precio propio todavía, el que ya tuviera enlazado).
 *
 * El producto sólo está activo mientras la edición está ABIERTA: con la
 * edición cerrada, `getPlanFromDb` lo rechaza y ninguna vía puede cobrarlo.
 */
export async function syncWorkshopEditionPrice(
  input: SyncWorkshopPriceInput,
): Promise<string | null> {
  const productId = workshopProductIdFor(input.slug);
  const isActive = input.status === WorkshopEditionStatus.OPEN;

  return prisma.$transaction(async (tx) => {
    const edition = await tx.workshopEdition.findUnique({
      where: { slug: input.slug },
      select: { id: true, productId: true, legacyProductId: true },
    });
    if (!edition) throw new Error(`WORKSHOP_NOT_FOUND:${input.slug}`);

    const own = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        prices: { orderBy: { validFrom: "desc" }, select: { currency: true, amountMinor: true } },
      },
    });

    const current = {
      cop: own?.prices.find((p) => p.currency === "COP")?.amountMinor ?? null,
      usd: own?.prices.find((p) => p.currency === "USD")?.amountMinor ?? null,
    };
    const rows = workshopPriceRowsToWrite(current, input);

    // Sin producto propio y sin precio nuevo: la edición sigue con lo que
    // tenga (un producto heredado o nada). No se inventa un producto sin precio.
    if (!own && rows.length === 0) return edition.productId;

    if (own) {
      await tx.product.update({
        where: { id: productId },
        data: { title: input.title, isActive },
      });
    } else {
      await tx.product.create({
        data: {
          id: productId,
          kind: ProductKind.WORKSHOP,
          title: input.title,
          sessionsLabel: "Taller en vivo",
          isActive,
          whatsappMessage: `Hola Dayana, me interesa el taller ${input.title}.`,
        },
      });
    }

    if (rows.length > 0) {
      await tx.productPrice.createMany({
        data: rows.map((r) => ({ productId, currency: r.currency, amountMinor: r.amountMinor })),
      });
    }

    if (edition.productId !== productId) {
      await tx.workshopEdition.update({
        where: { id: edition.id },
        data: {
          product: { connect: { id: productId } },
          // Quien pago por el producto anterior conserva el acceso: se guarda
          // una sola vez, el primero, que es el que tiene compradores.
          ...(edition.productId && !edition.legacyProductId
            ? { legacyProductId: edition.productId }
            : {}),
        },
      });
    }

    return productId;
  });
}

/**
 * Tras un cobro, liga la matrícula a su edición de taller.
 *
 * Sólo si el producto pertenece a UNA edición: un producto compartido
 * heredado no dice de qué edición es el pago, y adivinarlo por «la que esté
 * abierta» es justo el fallo que esto corrige. Nunca lanza: el cobro ya está
 * hecho y esto es contabilidad.
 */
export async function linkEnrollmentToWorkshopEdition(
  enrollmentId: string,
  productId: string,
): Promise<void> {
  try {
    const editions = await prisma.workshopEdition.findMany({
      where: { productId },
      select: { id: true },
      take: 2,
    });
    if (editions.length !== 1) return;
    await prisma.enrollment.updateMany({
      where: { id: enrollmentId, workshopEditionId: null },
      data: { workshopEditionId: editions[0].id },
    });
  } catch (e) {
    console.error("[workshop-pricing] no se pudo ligar la matrícula a su edición", e);
  }
}

/** Quién pagó una edición: matrículas activas o completadas ligadas a ella. */
export async function countPaidForEdition(editionId: string): Promise<number> {
  return prisma.enrollment.count({
    where: {
      workshopEditionId: editionId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    },
  });
}

/**
 * ¿Puede abrirse la edicion con estos precios? Necesita precio en pesos,
 * como todo taller del catalogo (en Colombia se cobra con Mercado Pago):
 * el que se escribe ahora o uno ya guardado en su producto propio.
 *
 * Una edicion heredada —todavia en un producto compartido y sin producto
 * propio— puede seguir abierta: sigue cobrando el precio heredado.
 */
export async function canOpenWithPrice(
  slug: string,
  copPesos: number | undefined,
  /** Se esta escribiendo algun precio ahora (aunque sea solo USD). */
  priceWritten = copPesos !== undefined,
): Promise<boolean> {
  if (copPesos) return true;
  const ownId = workshopProductIdFor(slug);
  const [ownCop, own, edition] = await Promise.all([
    prisma.productPrice.findFirst({
      where: { productId: ownId, currency: "COP" },
      select: { id: true },
    }),
    prisma.product.findUnique({ where: { id: ownId }, select: { id: true } }),
    prisma.workshopEdition.findUnique({ where: { slug }, select: { productId: true } }),
  ]);
  if (ownCop) return true;
  // La excepcion heredada solo vale si no se escribe ningun precio: escribir
  // uno (aunque sea solo USD) crea el producto propio y mueve la edicion, y
  // entonces necesita su propio precio en pesos.
  if (priceWritten) return false;
  return Boolean(edition?.productId && edition.productId !== ownId && !own);
}

/**
 * Alinea el producto propio de una edicion con su estado: activo solo si la
 * edicion esta ABIERTA. Lo llaman las funciones que escriben ediciones, asi
 * que ninguna via (panel, asistente, futuras) deja una edicion cerrada a la
 * venta ni una abierta sin poder cobrarse. Solo toca `taller-<slug>`.
 */
export async function alignWorkshopProductWithStatus(
  slug: string,
  status: WorkshopEditionStatus,
): Promise<void> {
  await prisma.product.updateMany({
    where: { id: workshopProductIdFor(slug) },
    data: { isActive: status === WorkshopEditionStatus.OPEN },
  });
}

/**
 * Desactiva el producto propio de estas ediciones: una edicion cerrada o
 * borrada no puede seguir cobrandose por `/pagar/p/<id>`, un enlace de pago
 * ya enviado o una pestaña vieja. Solo toca `taller-<slug>`.
 */
export async function deactivateWorkshopProducts(
  slugs: string[],
  db: Pick<typeof prisma, "product"> = prisma,
): Promise<void> {
  if (slugs.length === 0) return;
  await db.product.updateMany({
    where: { id: { in: slugs.map(workshopProductIdFor) } },
    data: { isActive: false },
  });
}
