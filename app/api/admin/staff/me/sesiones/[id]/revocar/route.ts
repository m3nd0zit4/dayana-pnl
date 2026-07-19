import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { revokeStaffSession, validateStaffSession } from "@/lib/auth/staff-sessions";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export const POST = async (_req: Request, ctx: RouteCtx) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id: sessionId } = await ctx.params;

  const row = await validateStaffSession(sessionId);
  if (!row || row.staffUserId !== staff.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await revokeStaffSession(sessionId);

  return NextResponse.json({ ok: true });
};
