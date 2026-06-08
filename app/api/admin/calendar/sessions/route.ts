import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listCalendarSessions } from "@/lib/crm/calendar-sessions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");

  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "missing_range" }, { status: 400 });
  }

  const from = new Date(fromParam);
  const to = new Date(toParam);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const sessions = await listCalendarSessions(from, to);
  return NextResponse.json({ sessions });
}
