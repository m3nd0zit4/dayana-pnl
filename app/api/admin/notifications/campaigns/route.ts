import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listRecentCampaigns } from "@/lib/crm/notification-campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const campaigns = await listRecentCampaigns();
  return NextResponse.json({ campaigns });
}
