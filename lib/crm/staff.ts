import type { StaffRole } from "@prisma/client";
import { fireNotification } from "@/lib/notifications/platform/emit";
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
  const staff = await prisma.staffUser.create({
    data: {
      email: input.email.trim().toLowerCase(),
      passwordHash,
      displayName: input.displayName,
      role: input.role ?? "OPERATOR",
    },
  });

  fireNotification({
    eventType: "STAFF_USER_CREATED",
    title: `Nuevo usuario del equipo: ${staff.displayName}`,
    body: `${staff.email} · rol ${staff.role}`,
    href: "/admin/team",
    entityType: "StaffUser",
    entityId: staff.id,
    staff: "ALL",
  });

  return staff;
};

/** OWNER-only edit from the team screen. Email is deliberately not editable
 * here (it's the login identifier — see updateStaffProfile). Guards against
 * dropping the team to zero active OWNERs, since nothing else would stop
 * that and it would lock everyone out of /admin/ajustes and team management. */
export const updateStaffUser = async (
  id: string,
  input: { displayName?: string; role?: StaffRole; isActive?: boolean }
) => {
  const current = await prisma.staffUser.findUnique({ where: { id } });
  if (!current) {
    throw new Error("NOT_FOUND");
  }

  const willStayOwner = (input.role ?? current.role) === "OWNER";
  const willStayActive = (input.isActive ?? current.isActive) === true;
  const losesOwnerStatus = current.role === "OWNER" && current.isActive && !(willStayOwner && willStayActive);
  if (losesOwnerStatus) {
    const otherActiveOwners = await prisma.staffUser.count({
      where: { role: "OWNER", isActive: true, id: { not: id } },
    });
    if (otherActiveOwners === 0) {
      throw new Error("LAST_OWNER");
    }
  }

  return prisma.staffUser.update({
    where: { id },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
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

/** Self-service profile edit from the CRM. Email/role are managed by an
 * OWNER via the team screen and are deliberately NOT editable here. */
export const updateStaffProfile = async (
  id: string,
  input: { displayName: string; themePreference?: "light" | "dark" | "system" }
) =>
  prisma.staffUser.update({
    where: { id },
    data: {
      displayName: input.displayName,
      ...(input.themePreference ? { themePreference: input.themePreference } : {}),
    },
  });

export const updateStaffAvatar = async (id: string, avatarUrl: string | null) =>
  prisma.staffUser.update({
    where: { id },
    data: { avatarUrl },
  });

export const updateStaffNotificationPrefs = async (
  id: string,
  prefs: { notifyEmail: boolean }
) =>
  prisma.staffUser.update({
    where: { id },
    data: prefs,
  });

