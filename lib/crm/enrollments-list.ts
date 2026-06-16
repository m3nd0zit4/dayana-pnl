import { EnrollmentStatus, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PLACEHOLDER_PHONE_PREFIX } from "./checkout-placeholder";

export type EnrollmentListFilters = {
  status?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

export const listEnrollmentsAdmin = async (filters: EnrollmentListFilters = {}) => {
  const q = filters.q?.trim() ?? "";
  const limit = filters.limit ?? 100;

  const where: Prisma.EnrollmentWhereInput = {
    NOT: { contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } } },
  };
  if (filters.status && filters.status !== "all") {
    where.status = filters.status as EnrollmentStatus;
  }
  if (q) {
    where.OR = [
      { contact: { firstName: { contains: q, mode: "insensitive" } } },
      { contact: { lastName: { contains: q, mode: "insensitive" } } },
      { contact: { phoneE164: { contains: q.replace(/\s/g, "") } } },
      { product: { title: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }

  return prisma.enrollment.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneE164: true,
        },
      },
      product: { select: { id: true, title: true, kind: true } },
      workshopEdition: { select: { title: true, slug: true } },
      payments: {
        where: { status: "APPROVED" },
        select: { id: true },
        take: 1,
      },
    },
  });
};
