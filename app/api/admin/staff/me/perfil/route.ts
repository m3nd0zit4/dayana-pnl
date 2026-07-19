import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { updateStaffProfile } from "@/lib/crm/staff";
import { updateStaffProfileSchema } from "@/lib/validations/admin";
import { writeAuditLog } from "@/lib/crm/audit";

export const dynamic = "force-dynamic";

export const PATCH = async (req: Request) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = updateStaffProfileSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await updateStaffProfile(staff.id, parsed.data);

  await writeAuditLog({
    staffUserId: staff.id,
    action: "STAFF_PROFILE_UPDATED",
    entityType: "StaffUser",
    entityId: staff.id,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
};
