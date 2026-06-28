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

export const getActiveProducts = async () =>
  prisma.product.findMany({
    where: { isActive: true },
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
