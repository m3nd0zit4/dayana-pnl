import { NextResponse } from "next/server";
import { PromoDiscountType } from "@prisma/client";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { canManageTeam } from "@/lib/crm/staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createPromoCode,
  listAllPromoCodes,
} from "@/lib/crm/promo-codes-admin";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  const promoCodes = await listAllPromoCodes();
  return NextResponse.json({ promoCodes });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const body = await readJson(req);
  if (!body?.code || !body?.discountType) {
    return apiError("missing_fields", 400);
  }

  try {
    const promoCode = await createPromoCode({
      code: body.code,
      description: body.description,
      discountType: body.discountType as PromoDiscountType,
      percentOff: body.percentOff != null ? Number(body.percentOff) : null,
      amountOffUsdMinor:
        body.amountOffUsdMinor != null ? Number(body.amountOffUsdMinor) : null,
      amountOffCopMinor:
        body.amountOffCopMinor != null ? Number(body.amountOffCopMinor) : null,
      maxRedemptions:
        body.maxRedemptions != null ? Number(body.maxRedemptions) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      // Lista vacía o ausente = el código vale para todos los productos. Igual
      // que en el PATCH, no se filtra la basura: `createPromoCode` la rechaza.
      productIds: Array.isArray(body.productIds) ? body.productIds : null,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "PromoCode",
      entityId: promoCode.id,
    });

    return NextResponse.json({ promoCode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "INVALID_CODE") {
      return apiError("invalid_code", 400);
    }
    if (msg === "INVALID_PERCENT") {
      return apiError("invalid_percent", 400);
    }
    if (msg === "INVALID_FIXED_AMOUNT") {
      return apiError("invalid_fixed_amount", 400);
    }
    if (msg.includes("Unique constraint")) {
      return apiError("duplicate_code", 409);
    }
    return apiError(msg, 400);
  }
});
