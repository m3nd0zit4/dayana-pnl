import { ProductKind, type Product } from "@prisma/client";
import { prisma } from "../db";

type ProductPrice = { currency: string; amountMinor: number; listAmountMinor: number | null };

const priceInclude = {
  prices: {
    orderBy: { validFrom: "desc" as const },
  },
} as const;

export const getProduct = async (productId: string) =>
  prisma.product.findUnique({
    where: { id: productId },
    include: priceInclude,
  });

/**
 * Catálogo vendible.
 *
 * Un curso de la biblioteca entra sólo si tiene `sellsStandalone`. Por defecto
 * no lo tiene: se accede con la mensualidad y no se compra suelto, que es como
 * funcionó esto desde el principio. La bandera es lo que decide, nunca el
 * hecho de tener una fila de precio — un precio puede existir en el CRM
 * mientras se prepara un lanzamiento sin que el botón salga a la web.
 */
export const getActiveProducts = async () =>
  prisma.product.findMany({
    where: {
      isActive: true,
      OR: [{ isCourseContent: false }, { sellsStandalone: true }],
    },
    orderBy: { sortOrder: "asc" },
    include: priceInclude,
  });

export const productSessionsTotal = (product: Product): number | null => {
  if (product.kind !== ProductKind.THERAPY) return null;
  return product.sessionsCount ?? null;
};

export const latestUsdPrice = (
  product: Product & { prices: ProductPrice[] }
): ProductPrice | null =>
  product.prices.find((p) => p.currency === "USD") ?? null;

export const latestCopPrice = (
  product: Product & { prices: ProductPrice[] }
): ProductPrice | null =>
  product.prices.find((p) => p.currency === "COP") ?? null;
