import { NextResponse } from "next/server";
import type { StaffRole } from "@prisma/client";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { validateStaffPassword } from "@/lib/auth/password-policy";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  canManageTeam,
  createStaffUser,
  listStaffUsers,
  updateStaffUser,
} from "@/lib/crm/staff";
import { createStaffSchema, updateStaffSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async ({ staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const team = await listStaffUsers();
  return NextResponse.json({
    team: team.map(({ passwordHash: _, ...rest }) => rest),
    currentRole: staff.role,
  });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const raw = await readJson(req);
  const parsed = createStaffSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError("invalid_fields", 400, { details: parsed.error.flatten() });
  }

  const passwordCheck = validateStaffPassword(parsed.data.password);
  if (!passwordCheck.ok) {
    return apiError("weak_password", 400, { message: passwordCheck.error });
  }

  const created = await createStaffUser({
    email: parsed.data.email,
    password: parsed.data.password,
    displayName: parsed.data.displayName,
    role: parsed.data.role as StaffRole,
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "STAFF_CREATED",
    entityType: "StaffUser",
    entityId: created.id,
    changes: { role: created.role, email: created.email },
  });

  const { passwordHash: _, ...safe } = created;
  return NextResponse.json({ staff: safe });
});

export const PATCH = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const raw = await readJson(req);
  const parsed = updateStaffSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError("invalid_fields", 400, { details: parsed.error.flatten() });
  }

  try {
    const { id, ...changes } = parsed.data;
    const updated = await updateStaffUser(id, changes);

    fireAuditLog({
      staffUserId: staff.id,
      action: "STAFF_UPDATED",
      entityType: "StaffUser",
      entityId: updated.id,
      changes,
    });

    const { passwordHash: _, ...safe } = updated;
    return NextResponse.json({ staff: safe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "NOT_FOUND") {
      return apiError("not_found", 404);
    }
    if (msg === "LAST_OWNER") {
      return apiError("last_owner", 409);
    }
    return apiError(msg, 400);
  }
});
