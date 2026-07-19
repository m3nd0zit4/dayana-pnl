import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { revokeAllStaffSessions } from "@/lib/auth/staff-sessions";

export const dynamic = "force-dynamic";

export const POST = async () => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  await revokeAllStaffSessions(staff.id);

  return NextResponse.json({ ok: true });
};
