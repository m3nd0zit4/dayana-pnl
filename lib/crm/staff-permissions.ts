import type { StaffRole } from "@prisma/client";

/** Pure role checks — safe to import from client components (no Prisma). */

export const canEditClinicalNotes = (role: StaffRole) =>
  role === "OWNER" || role === "OPERATOR";

export const canManageTeam = (role: StaffRole) => role === "OWNER";

export const canWriteCrm = (role: StaffRole) =>
  role === "OWNER" || role === "OPERATOR" || role === "DEVELOPER";
