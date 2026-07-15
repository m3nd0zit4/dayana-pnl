import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "../db";

/**
 * True if this contact has a paid, active purchase of the given Product —
 * the same status model course/therapy checkout already uses. Keyed on
 * Product, not WorkshopEdition, matching how checkout is keyed throughout
 * the codebase (see lib/plans-from-db.ts).
 */
export const hasActiveWorkshopEnrollment = async (
  contactId: string,
  productId: string
): Promise<boolean> => {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      contactId,
      productId,
      status: EnrollmentStatus.ACTIVE,
    },
    select: { id: true },
  });
  return enrollment !== null;
};
