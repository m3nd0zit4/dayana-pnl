import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { revokeStaffSession, validateStaffSession } from "@/lib/auth/staff-sessions";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withStaff<Params>("read", async ({ staff, params }) => {
  const { id: sessionId } = params;

  const row = await validateStaffSession(sessionId);
  if (!row || row.staffUserId !== staff.id) {
    return apiError("not_found", 404);
  }

  await revokeStaffSession(sessionId);

  return NextResponse.json({ ok: true });
});
