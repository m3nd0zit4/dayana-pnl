import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
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

export const GET = withStaff("read", async () => {
  const usdToCopRate = await resolveUsdToCopRate();
  const fromCrm = await getUsdToCopRateSetting();
  const operationalTimezone = await getOperationalTimezone();

  return NextResponse.json({
    usdToCopRate,
    source: fromCrm != null ? "crm" : "env_or_default",
    operationalTimezone,
  });
});

export const PATCH = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const body = (await readJson(req)) as {
    usdToCopRate?: unknown;
    operationalTimezone?: unknown;
  } | null;

  if (!body || (body.usdToCopRate == null && body.operationalTimezone == null)) {
    return apiError("invalid_body", 400);
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
        return apiError("invalid_rate", 400);
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
        return apiError("invalid_timezone", 400);
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
      return apiError("invalid_rate", 400);
    }
    if (msg === "INVALID_TIMEZONE") {
      return apiError("invalid_timezone", 400);
    }
    return apiError(msg, 500);
  }
});
