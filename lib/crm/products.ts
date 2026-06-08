import { ProductKind, type Product } from "@prisma/client";
import { prisma } from "../db";

export const getProduct = async (productId: string) =>
  prisma.product.findUnique({
    where: { id: productId },
    include: {
      prices: {
        where: { currency: "USD" },
        orderBy: { validFrom: "desc" },
        take: 1,
      },
    },
  });

export const getActiveProducts = async () =>
  prisma.product.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      prices: {
        where: { currency: "USD" },
        orderBy: { validFrom: "desc" },
        take: 1,
      },
    },
  });

export const productSessionsTotal = (product: Product): number | null => {
  if (product.kind !== ProductKind.THERAPY) return null;
  return product.sessionsCount ?? null;
};

export const latestUsdPrice = (
  product: Product & {
    prices: { amountMinor: number; listAmountMinor: number | null }[];
  }
): { amountMinor: number; listAmountMinor: number | null } | null =>
  product.prices[0] ?? null;
