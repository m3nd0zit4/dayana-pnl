import { NextRequest, NextResponse } from "next/server";
import type { StaffRole } from "@prisma/client";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
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

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const team = await listStaffUsers();
  return NextResponse.json({
    team: team.map(({ passwordHash: _, ...rest }) => rest),
    currentRole: staff.role,
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = createStaffSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_fields", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const passwordCheck = validateStaffPassword(parsed.data.password);
  if (!passwordCheck.ok) {
    return NextResponse.json(
      { error: "weak_password", message: passwordCheck.error },
      { status: 400 }
    );
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
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = updateStaffSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_fields", details: parsed.error.flatten() },
      { status: 400 }
    );
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
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (msg === "LAST_OWNER") {
      return NextResponse.json({ error: "last_owner" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
