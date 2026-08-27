import { PromoDiscountType } from "@prisma/client";
import { prisma } from "../db";

/**
 * `PromoCodeProduct` es una tabla puente, así que Prisma devuelve
 * `[{ product: {...} }]`. Quien consume esto quiere la lista de productos, no
 * la de filas puente.
 *
 * Se aplana AQUÍ y no en cada llamante porque la forma anidada ya costó cara:
 * el panel leía `x.id` sobre la fila puente —donde vale `undefined`— y al
 * guardar mandaba una lista de `undefined` que el servidor interpretaba como
 * «sin restricción», borrando en silencio los productos del código. Un código
 * de 6 sesiones pasaba a servir para todo el catálogo con sólo abrirlo y
 * guardar.
 */
const productInclude = {
  products: { select: { product: { select: { id: true, title: true } } } },
} as const;

type LinkedProduct = { id: string; title: string };
type PromoCodeRow = { products: { product: LinkedProduct }[] };

const flattenProducts = <T extends PromoCodeRow>(
  row: T
): Omit<T, "products"> & { products: LinkedProduct[] } => ({
  ...row,
  products: row.products.map((p) => p.product),
});

export const listAllPromoCodes = async () => {
  const rows = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    include: productInclude,
  });
  return rows.map(flattenProducts);
};

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
  if (
    input.productIds != null &&
    input.productIds.some((x) => typeof x !== "string" || x.trim() === "")
  ) {
    throw new Error("INVALID_PRODUCT_IDS");
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

  /**
   * Quitar la restricción de productos abre el código a TODO el catálogo, así
   * que tiene que ser una decisión explícita y no el residuo de una lista que
   * llegó mal. Si el llamante manda algo que no son ids utilizables, se
   * rechaza en vez de interpretarlo como «para todos».
   */
  if (input.productIds != null) {
    const clean = input.productIds.filter(
      (x) => typeof x === "string" && x.trim() !== ""
    );
    if (clean.length !== input.productIds.length) {
      throw new Error("INVALID_PRODUCT_IDS");
    }
  }

  const discountType = input.discountType ?? existing.discountType;
  if (discountType === "PERCENT") {
    const percentOff = input.percentOff !== undefined ? input.percentOff : existing.percentOff;
    if (!percentOff || percentOff < 1 || percentOff > 100) {
      throw new Error("INVALID_PERCENT");
    }
  }

  const updated = await prisma.promoCode.update({
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
    include: productInclude,
  });
  return flattenProducts(updated);
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
