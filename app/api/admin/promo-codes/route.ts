import { NextRequest, NextResponse } from "next/server";
import { PromoDiscountType } from "@prisma/client";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { canManageTeam } from "@/lib/crm/staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createPromoCode,
  listAllPromoCodes,
} from "@/lib/crm/promo-codes-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const promoCodes = await listAllPromoCodes();
  return NextResponse.json({ promoCodes });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.code || !body?.discountType) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
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
      // Lista vacía o ausente = el código vale para todos los productos.
      productIds: Array.isArray(body.productIds)
        ? body.productIds.filter((x: unknown): x is string => typeof x === "string")
        : null,
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
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }
    if (msg === "INVALID_PERCENT") {
      return NextResponse.json({ error: "invalid_percent" }, { status: 400 });
    }
    if (msg === "INVALID_FIXED_AMOUNT") {
      return NextResponse.json({ error: "invalid_fixed_amount" }, { status: 400 });
    }
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "duplicate_code" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
