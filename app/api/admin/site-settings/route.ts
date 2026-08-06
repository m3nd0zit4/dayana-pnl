import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { revalidatePublicCatalog } from "@/lib/crm/revalidate-catalog";
import {
  getUsdToCopRateSetting,
  setUsdToCopRateSetting,
  resolveUsdToCopRate,
} from "@/lib/crm/site-settings";
import {
  getOperationalTimezone,
  setOperationalTimezone,
} from "@/lib/crm/operational-timezone";
import { parseUsdToCopRate } from "@/lib/pricing/usd-to-cop";
import { canManageTeam } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const usdToCopRate = await resolveUsdToCopRate();
  const fromCrm = await getUsdToCopRateSetting();
  const operationalTimezone = await getOperationalTimezone();

  return NextResponse.json({
    usdToCopRate,
    source: fromCrm != null ? "crm" : "env_or_default",
    operationalTimezone,
  });
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    usdToCopRate?: unknown;
    operationalTimezone?: unknown;
  } | null;

  if (!body || (body.usdToCopRate == null && body.operationalTimezone == null)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result: {
    usdToCopRate?: number;
    source?: "crm" | "env_or_default";
    operationalTimezone?: string;
  } = {};

  try {
    if (body.usdToCopRate != null) {
      const rate = parseUsdToCopRate(body.usdToCopRate);
      if (rate == null) {
        return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
      }
      await setUsdToCopRateSetting(rate);
      fireAuditLog({
        staffUserId: staff.id,
        action: "UPDATE",
        entityType: "SiteSetting",
        entityId: "usd_to_cop_rate",
        changes: { usdToCopRate: rate },
      });
      result.usdToCopRate = rate;
      result.source = "crm";
      revalidatePublicCatalog();
    }

    if (body.operationalTimezone != null) {
      if (typeof body.operationalTimezone !== "string") {
        return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
      }
      await setOperationalTimezone(body.operationalTimezone);
      const operationalTimezone = await getOperationalTimezone();
      fireAuditLog({
        staffUserId: staff.id,
        action: "UPDATE",
        entityType: "SiteSetting",
        entityId: "operational_timezone",
        changes: { operationalTimezone },
      });
      result.operationalTimezone = operationalTimezone;
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "INVALID_RATE") {
      return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
    }
    if (msg === "INVALID_TIMEZONE") {
      return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
