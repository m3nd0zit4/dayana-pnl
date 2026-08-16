import { PromoDiscountType } from "@prisma/client";
import { prisma } from "../db";

export const listAllPromoCodes = async () =>
  prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      products: {
        select: { product: { select: { id: true, title: true } } },
      },
    },
  });

export type CreatePromoCodeInput = {
  code: string;
  description?: string | null;
  discountType: PromoDiscountType;
  percentOff?: number | null;
  amountOffUsdMinor?: number | null;
  amountOffCopMinor?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
  /**
   * Productos a los que se limita. Lista vacía (o ausente) = vale para todos.
   * Ese valor por defecto es lo que deja intactos los códigos ya emitidos.
   */
  productIds?: string[] | null;
};

const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

export const createPromoCode = async (input: CreatePromoCodeInput) => {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(code)) {
    throw new Error("INVALID_CODE");
  }
  if (input.discountType === "PERCENT") {
    if (!input.percentOff || input.percentOff < 1 || input.percentOff > 100) {
      throw new Error("INVALID_PERCENT");
    }
  } else if (
    (input.amountOffUsdMinor == null || input.amountOffUsdMinor <= 0) &&
    (input.amountOffCopMinor == null || input.amountOffCopMinor <= 0)
  ) {
    throw new Error("INVALID_FIXED_AMOUNT");
  }

  return prisma.promoCode.create({
    data: {
      code,
      description: input.description?.trim() || null,
      discountType: input.discountType,
      percentOff: input.discountType === "PERCENT" ? input.percentOff : null,
      amountOffUsdMinor:
        input.discountType === "FIXED_AMOUNT" ? input.amountOffUsdMinor ?? null : null,
      amountOffCopMinor:
        input.discountType === "FIXED_AMOUNT" ? input.amountOffCopMinor ?? null : null,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
      products: input.productIds?.length
        ? { create: input.productIds.map((productId) => ({ productId })) }
        : undefined,
    },
  });
};

export type UpdatePromoCodeInput = Partial<CreatePromoCodeInput> & {
  isActive?: boolean;
};

export const updatePromoCode = async (id: string, input: UpdatePromoCodeInput) => {
  const existing = await prisma.promoCode.findUnique({ where: { id } });
  if (!existing) throw new Error("NOT_FOUND");

  const discountType = input.discountType ?? existing.discountType;
  if (discountType === "PERCENT") {
    const percentOff = input.percentOff !== undefined ? input.percentOff : existing.percentOff;
    if (!percentOff || percentOff < 1 || percentOff > 100) {
      throw new Error("INVALID_PERCENT");
    }
  }

  return prisma.promoCode.update({
    where: { id },
    data: {
      code: input.code ? normalizeCode(input.code) : undefined,
      description:
        input.description !== undefined ? input.description?.trim() || null : undefined,
      discountType: input.discountType,
      percentOff:
        discountType === "PERCENT"
          ? (input.percentOff ?? existing.percentOff)
          : input.discountType !== undefined
            ? null
            : undefined,
      amountOffUsdMinor:
        discountType === "FIXED_AMOUNT"
          ? (input.amountOffUsdMinor !== undefined
              ? input.amountOffUsdMinor
              : existing.amountOffUsdMinor)
          : input.discountType !== undefined
            ? null
            : undefined,
      amountOffCopMinor:
        discountType === "FIXED_AMOUNT"
          ? (input.amountOffCopMinor !== undefined
              ? input.amountOffCopMinor
              : existing.amountOffCopMinor)
          : input.discountType !== undefined
            ? null
            : undefined,
      isActive: input.isActive,
      maxRedemptions: input.maxRedemptions,
      expiresAt: input.expiresAt,
      // `undefined` = no se tocó la selección; una lista (incluso vacía) la
      // reemplaza entera. Borrar y volver a crear es lo correcto aquí: la
      // tabla no tiene más columnas que las dos claves, así que no hay nada
      // que conservar de las filas viejas.
      products:
        input.productIds === undefined
          ? undefined
          : {
              deleteMany: {},
              ...(input.productIds && input.productIds.length
                ? {
                    create: input.productIds.map((productId) => ({ productId })),
                  }
                : {}),
            },
    },
    include: {
      products: { select: { product: { select: { id: true, title: true } } } },
    },
  });
};

export const deletePromoCode = async (id: string) => {
  const existing = await prisma.promoCode.findUnique({
    where: { id },
    select: { timesRedeemed: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  if (existing.timesRedeemed > 0) {
    // Preserve redemption history — deactivate instead of deleting.
    return prisma.promoCode.update({ where: { id }, data: { isActive: false } });
  }
  return prisma.promoCode.delete({ where: { id } });
};
