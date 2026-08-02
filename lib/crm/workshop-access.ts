import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "../db";
import { getStaffSession } from "../auth/staff-session";
import { getMemberSession } from "../auth/member-session";
import { canManageTeam } from "./staff-permissions";
import { resolveSessionCheckoutContact } from "./checkout-session-contact";

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

export type WorkshopAccess = { hasAccess: boolean; isOwner: boolean };

/**
 * Resolves whether the current viewer can see a workshop's real (paid)
 * content. OWNER staff always can — read-only, never creates an Enrollment.
 * A signed-in member, or staff paying as their own CRM contact, needs a
 * real ACTIVE Enrollment. A workshop with no linked product is fully
 * public. Shared by the /taller-virtual listing card and the [slug] detail
 * page gate so the two can never disagree with each other.
 */
export const resolveWorkshopAccess = async (
  productId: string | null
): Promise<WorkshopAccess> => {
  const staff = await getStaffSession();
  if (staff && canManageTeam(staff.role)) {
    return { hasAccess: true, isOwner: true };
  }

  if (!productId) return { hasAccess: true, isOwner: false };

  const member = await getMemberSession();
  if (member) {
    const has = await hasActiveWorkshopEnrollment(member.contact.id, productId);
    return { hasAccess: has, isOwner: false };
  }

  const sessionContact = await resolveSessionCheckoutContact();
  if (sessionContact?.contactId) {
    const has = await hasActiveWorkshopEnrollment(sessionContact.contactId, productId);
    return { hasAccess: has, isOwner: false };
  }

  return { hasAccess: false, isOwner: false };
};
