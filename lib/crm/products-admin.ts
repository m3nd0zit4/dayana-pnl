import { ProductKind } from "@prisma/client";
import { prisma } from "../db";
import { uniqueSlug } from "./slug";

const priceInclude = {
  prices: {
    orderBy: { validFrom: "desc" as const },
  },
} as const;

export const listAllProducts = async () =>
  prisma.product.findMany({
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: priceInclude,
  });

export const createProduct = async (input: {
  id?: string;
  kind: ProductKind;
  title: string;
  sessionsLabel: string;
  sessionsCount?: number | null;
  description?: string;
  amountUsd: number;
  listAmountUsd?: number | null;
  amountCop?: number | null;
  listAmountCop?: number | null;
  sortOrder?: number;
}) => {
  const id =
    input.id?.trim() ||
    (await uniqueSlug(input.title, async (slug) => {
      const found = await prisma.product.findUnique({ where: { id: slug } });
      return !!found;
    }));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error("INVALID_ID");
  }

  if (
    input.kind === ProductKind.THERAPY &&
    (!input.sessionsCount || input.sessionsCount < 1)
  ) {
    throw new Error("THERAPY_REQUIRES_SESSIONS");
  }

  const maxOrder = await prisma.product.aggregate({ _max: { sortOrder: true } });
  const sortOrder = input.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1;

  const priceRows = [
    {
      currency: "USD",
      amountMinor: Math.round(input.amountUsd * 100),
      listAmountMinor: input.listAmountUsd ? Math.round(input.listAmountUsd * 100) : null,
    },
    ...(input.amountCop != null
      ? [
          {
            currency: "COP",
            amountMinor: Math.round(input.amountCop),
            listAmountMinor: input.listAmountCop
              ? Math.round(input.listAmountCop)
              : null,
          },
        ]
      : []),
  ];

  const product = await prisma.product.create({
    data: {
      id,
      kind: input.kind,
      title: input.title.trim(),
      sessionsLabel: input.sessionsLabel.trim(),
      sessionsCount: input.sessionsCount ?? null,
      description: input.description?.trim() || null,
      isActive: true,
      sortOrder,
      prices: { create: priceRows },
    },
    include: priceInclude,
  });

  return product;
};

export const updateProduct = async (
  id: string,
  input: {
    title?: string;
    sessionsLabel?: string;
    sessionsCount?: number | null;
    description?: string;
    isActive?: boolean;
    kind?: ProductKind;
    amountUsd?: number;
    listAmountUsd?: number | null;
    amountCop?: number | null;
    listAmountCop?: number | null;
    sortOrder?: number;
  }
) => {
  const existing = await prisma.product.findUnique({
    where: { id },
    include: priceInclude,
  });
  if (!existing) throw new Error("NOT_FOUND");

  const nextKind = input.kind ?? existing.kind;
  const nextSessions =
    input.sessionsCount !== undefined ? input.sessionsCount : existing.sessionsCount;
  if (nextKind === ProductKind.THERAPY && (!nextSessions || nextSessions < 1)) {
    throw new Error("THERAPY_REQUIRES_SESSIONS");
  }

  await prisma.product.update({
    where: { id },
    data: {
      title: input.title?.trim(),
      sessionsLabel: input.sessionsLabel?.trim(),
      sessionsCount: input.sessionsCount,
      description: input.description?.trim(),
      isActive: input.isActive,
      kind: input.kind,
      sortOrder: input.sortOrder,
    },
  });

  if (input.amountUsd !== undefined) {
    const amountMinor = Math.round(input.amountUsd * 100);
    const listAmountMinor =
      input.listAmountUsd != null ? Math.round(input.listAmountUsd * 100) : null;
    const latestUsd = existing.prices.find((p) => p.currency === "USD");
    if (
      !latestUsd ||
      latestUsd.amountMinor !== amountMinor ||
      latestUsd.listAmountMinor !== listAmountMinor
    ) {
      await prisma.productPrice.create({
        data: { productId: id, currency: "USD", amountMinor, listAmountMinor },
      });
    }
  }

  if (input.amountCop !== undefined) {
    if (input.amountCop == null) {
      await prisma.productPrice.deleteMany({ where: { productId: id, currency: "COP" } });
    } else {
      const amountMinor = Math.round(input.amountCop);
      const listAmountMinor =
        input.listAmountCop != null ? Math.round(input.listAmountCop) : null;
      const latestCop = existing.prices.find((p) => p.currency === "COP");
      if (
        !latestCop ||
        latestCop.amountMinor !== amountMinor ||
        latestCop.listAmountMinor !== listAmountMinor
      ) {
        await prisma.productPrice.create({
          data: { productId: id, currency: "COP", amountMinor, listAmountMinor },
        });
      }
    }
  }

  return prisma.product.findUnique({
    where: { id },
    include: priceInclude,
  });
};

export const deactivateProduct = async (id: string) => {
  const enrollments = await prisma.enrollment.count({ where: { productId: id } });
  if (enrollments > 0) {
    return prisma.product.update({
      where: { id },
      data: { isActive: false },
      include: priceInclude,
    });
  }
  await prisma.productPrice.deleteMany({ where: { productId: id } });
  return prisma.product.delete({
    where: { id },
    include: priceInclude,
  });
};
