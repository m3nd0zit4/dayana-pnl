import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { canManageTeam } from "@/lib/crm/staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deletePromoCode, updatePromoCode } from "@/lib/crm/promo-codes-admin";

type Params = { id: string };

export const dynamic = "force-dynamic";

export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const { id } = params;
  const body = await readJson(req);
  if (!body) {
    return apiError("missing_fields", 400);
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
      /**
       * `undefined` deja la selección como está; un array la reemplaza entera.
       *
       * NO se filtran los elementos inválidos: hacerlo convertía una lista mal
       * formada en `[]`, y `[]` significa «vale para todos los productos». Así
       * es como un código restringido a 6 sesiones acababa abierto a todo el
       * catálogo sin que nadie lo pidiera. Ahora la lista viaja tal cual y
       * `updatePromoCode` la rechaza si trae basura.
       */
      productIds: Array.isArray(body.productIds) ? body.productIds : undefined,
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
      return apiError("not_found", 404);
    }
    if (msg === "INVALID_PERCENT") {
      return apiError("invalid_percent", 400);
    }
    if (msg === "INVALID_PRODUCT_IDS") {
      return apiError("invalid_product_ids", 400);
    }
    return apiError(msg, 400);
  }
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const { id } = params;

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
    return apiError("not_found", 404);
  }
});
