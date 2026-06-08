import { NextRequest, NextResponse } from "next/server";
import type { StaffRole } from "@prisma/client";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  canManageTeam,
  createStaffUser,
  listStaffUsers,
} from "@/lib/crm/staff";

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

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.displayName) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const created = await createStaffUser({
    email: body.email,
    password: body.password,
    displayName: body.displayName,
    role: (body.role as StaffRole) ?? "OPERATOR",
  });

  await writeAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "StaffUser",
    entityId: created.id,
  });

  const { passwordHash: _, ...safe } = created;
  return NextResponse.json({ staff: safe });
}
