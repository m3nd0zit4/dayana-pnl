import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  getDashboardStats,
  PREVIEW_DASHBOARD,
} from "@/lib/crm/dashboard-stats";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isCrmUiPreview()) {
    return NextResponse.json(PREVIEW_DASHBOARD);
  }

  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  try {
    const data = await getDashboardStats();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503 }
    );
  }
}
