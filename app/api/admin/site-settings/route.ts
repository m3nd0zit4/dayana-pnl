import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { revalidatePublicCatalog } from "@/lib/crm/revalidate-catalog";
import {
  getUsdToCopRateSetting,
  setUsdToCopRateSetting,
} from "@/lib/crm/site-settings";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";
import { parseUsdToCopRate } from "@/lib/pricing/usd-to-cop";
import { canManageTeam } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const usdToCopRate = await resolveUsdToCopRate();
  const fromCrm = await getUsdToCopRateSetting();

  return NextResponse.json({
    usdToCopRate,
    source: fromCrm != null ? "crm" : "env_or_default",
  });
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rate = parseUsdToCopRate(body?.usdToCopRate);
  if (rate == null) {
    return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
  }

  try {
    await setUsdToCopRateSetting(rate);
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "SiteSetting",
      entityId: "usd_to_cop_rate",
      changes: { usdToCopRate: rate },
    });
    revalidatePublicCatalog();
    return NextResponse.json({ usdToCopRate: rate, source: "crm" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "INVALID_RATE") {
      return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
