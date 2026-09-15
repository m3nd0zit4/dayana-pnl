import { NextResponse } from "next/server";
import { withStaff } from "@/lib/api/handler";
import { revokeAllStaffSessions } from "@/lib/auth/staff-sessions";

export const dynamic = "force-dynamic";

export const POST = withStaff("read", async ({ staff }) => {
  await revokeAllStaffSessions(staff.id);

  return NextResponse.json({ ok: true });
});
