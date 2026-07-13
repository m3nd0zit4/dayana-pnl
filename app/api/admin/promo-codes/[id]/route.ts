import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { canManageTeam } from "@/lib/crm/staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deletePromoCode, updatePromoCode } from "@/lib/crm/promo-codes-admin";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const promoCode = await updatePromoCode(id, {
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      percentOff: body.percentOff != null ? Number(body.percentOff) : body.percentOff,
      amountOffUsdMinor:
        body.amountOffUsdMinor != null
          ? Number(body.amountOffUsdMinor)
          : body.amountOffUsdMinor,
      amountOffCopMinor:
        body.amountOffCopMinor != null
          ? Number(body.amountOffCopMinor)
          : body.amountOffCopMinor,
      isActive: body.isActive,
      maxRedemptions:
        body.maxRedemptions != null ? Number(body.maxRedemptions) : body.maxRedemptions,
      expiresAt: body.expiresAt !== undefined ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "PromoCode",
      entityId: id,
      changes: body,
    });

    return NextResponse.json({ promoCode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (msg === "INVALID_PERCENT") {
      return NextResponse.json({ error: "invalid_percent" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  try {
    const promoCode = await deletePromoCode(id);
    fireAuditLog({
      staffUserId: staff.id,
      action: "DELETE",
      entityType: "PromoCode",
      entityId: id,
    });
    return NextResponse.json({ promoCode });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
