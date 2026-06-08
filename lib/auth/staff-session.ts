import { auth } from "@/auth";
import type { StaffUser } from "@prisma/client";
import { getStaffById } from "@/lib/crm/staff";

export const getStaffSession = async (): Promise<StaffUser | null> => {
  const session = await auth();
  const staffId = session?.user?.id;
  if (!staffId) return null;
  return getStaffById(staffId);
};

export const requireStaffSession = async (): Promise<StaffUser> => {
  const staff = await getStaffSession();
  if (!staff || !staff.isActive) {
    throw new Error("STAFF_UNAUTHORIZED");
  }
  return staff;
};
