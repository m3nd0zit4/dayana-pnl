import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { updateStaffProfile } from "@/lib/crm/staff";
import { updateStaffProfileSchema } from "@/lib/validations/admin";
import { writeAuditLog } from "@/lib/crm/audit";

export const dynamic = "force-dynamic";

export const PATCH = withStaff("read", async ({ req, staff }) => {
  const parsed = updateStaffProfileSchema.safeParse(
    await readJson(req)
  );
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  await updateStaffProfile(staff.id, parsed.data);

  await writeAuditLog({
    staffUserId: staff.id,
    action: "STAFF_PROFILE_UPDATED",
    entityType: "StaffUser",
    entityId: staff.id,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
});
