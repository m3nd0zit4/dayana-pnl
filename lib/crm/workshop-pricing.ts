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
      select: { id: true, productId: true },
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
        data: { product: { connect: { id: productId } } },
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
