import { EnrollmentStatus, ProductKind } from "@prisma/client";
import { prisma } from "../db";

export type MemberWorkshop = {
  enrollmentId: string;
  productId: string;
  title: string;
  /** Public page for the linked edition, when one exists. */
  slug: string | null;
  dateLabel: string | null;
  startsAtIso: string | null;
  paidAt: Date | null;
  currency: string | null;
  amountMinor: number | null;
};

/**
 * Workshops this contact has bought (ACTIVE) or attended (COMPLETED),
 * newest first — one row per enrollment. The public link comes from the
 * product's linked WorkshopEdition; a product can back multiple editions
 * over time, so prefer the most recently updated one.
 */
export const getMemberWorkshops = async (
  contactId: string
): Promise<MemberWorkshop[]> => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      contactId,
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      product: { kind: ProductKind.WORKSHOP },
    },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: {
          workshopEditions: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { slug: true, title: true, dateLabel: true, startsAt: true },
          },
        },
      },
    },
  });

  return enrollments.map((en) => {
    const edition = en.product.workshopEditions[0] ?? null;
    return {
      enrollmentId: en.id,
      productId: en.productId,
      title: edition?.title ?? en.product.title,
      slug: edition?.slug ?? null,
      dateLabel: edition?.dateLabel ?? null,
      startsAtIso: edition?.startsAt ? edition.startsAt.toISOString() : null,
      paidAt: en.paidAt,
      currency: en.currency,
      amountMinor: en.amountMinor,
    };
  });
};
