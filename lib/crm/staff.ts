import type { StaffRole } from "@prisma/client";
import { prisma } from "../db";
import { hashStaffPassword } from "../auth/password";

export {
  canEditClinicalNotes,
  canManageTeam,
  canWriteCrm,
} from "./staff-permissions";

export const getStaffById = async (id: string) =>
  prisma.staffUser.findUnique({
    where: { id },
  });

export const getStaffByEmail = async (email: string) =>
  prisma.staffUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

export const requireStaffById = async (id: string) => {
  const staff = await getStaffById(id);
  if (!staff || !staff.isActive) {
    return null;
  }
  return staff;
};

export const createStaffUser = async (input: {
  email: string;
  password: string;
  displayName: string;
  role?: StaffRole;
}) => {
  const passwordHash = await hashStaffPassword(input.password);
  return prisma.staffUser.create({
    data: {
      email: input.email.trim().toLowerCase(),
      passwordHash,
      displayName: input.displayName,
      role: input.role ?? "OPERATOR",
    },
  });
};

export const updateStaffPassword = async (id: string, password: string) => {
  const passwordHash = await hashStaffPassword(password);
  return prisma.staffUser.update({
    where: { id },
    data: { passwordHash },
  });
};

export const listStaffUsers = async () =>
  prisma.staffUser.findMany({ orderBy: { createdAt: "asc" } });

