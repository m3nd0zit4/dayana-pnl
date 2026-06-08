import { NextResponse } from "next/server";

import { resolveAdminStaff } from "@/lib/auth/api-staff";

import { listPendingScheduleSlots } from "@/lib/crm/calendar-sessions";



export const dynamic = "force-dynamic";



export async function GET() {

  const staff = await resolveAdminStaff();

  if (staff instanceof NextResponse) return staff;



  const slots = await listPendingScheduleSlots();

  return NextResponse.json({ slots });

}

