import { ProductKind } from "@prisma/client";
import { revalidatePublicCatalog } from "@/lib/crm/revalidate-catalog";
import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createProduct,
  deactivateProduct,
  listAllProducts,
  updateProduct,
} from "@/lib/crm/products-admin";
import { canManageTeam } from "@/lib/crm/staff";
import {
  createProductSchema,
  updateProductSchema,
} from "@/lib/validations/admin";
import { prisma } from "@/lib/db";
import {
  changeSubscriptionPrice,
  hasSubscriptionPlan,
} from "@/lib/pricing/price-sync";
import { emitPriceChanged } from "@/lib/inngest/events";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const products = await listAllProducts();
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const input = parsed.data;
  if (input.amountUsd == null && input.amountCop == null) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const product = await createProduct({
      id: input.id,
      kind: input.kind as ProductKind,
      title: input.title,
      imageUrl: input.imageUrl ?? null,
      sessionsLabel: input.sessionsLabel ?? input.title,
      sessionsCount: input.sessionsCount ?? null,
      description: input.description,
      tag: input.tag,
      highlight: input.highlight,
      unitPriceLabel: input.unitPriceLabel,
      therapyHeadline: input.therapyHeadline,
      whatsappMessage: input.whatsappMessage,
      // Se crea desde la pestaña COP sin precio en dólares: queda a 0 y se
      // pone después. `isPlanVisibleForRegion` ya oculta lo que no tiene
      // precio en la moneda del visitante, así que no se publica roto.
      amountUsd: input.amountUsd ?? 0,
      listAmountUsd: input.listAmountUsd ?? null,
      amountCop: input.amountCop ?? null,
      listAmountCop: input.listAmountCop ?? null,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "Product",
      entityId: product.id,
    });

    revalidatePublicCatalog();
    return NextResponse.json({ product });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "INVALID_ID") {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsedPatch = updateProductSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsedPatch.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsedPatch.data;

  const amountUsd = body.amountUsd;
  const amountCop = body.amountCop;

  /**
   * El precio de un producto con plan recurrente va por su propio camino: los
   * proveedores confirman primero y sólo entonces se persiste. Si no cuadra, se
   * corta aquí y no se toca NADA del producto — guardar el título mientras el
   * precio queda a medias sería peor que no guardar.
   */
  const existing = await prisma.product.findUnique({
    where: { id: String(body.id) },
    select: { paypalPlanId: true, mercadoPagoPreapprovalPlanId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const priceGoesThroughSync =
    hasSubscriptionPlan(existing) &&
    (amountUsd !== undefined || amountCop !== undefined);

  if (priceGoesThroughSync) {
    const result = await changeSubscriptionPrice(
      String(body.id),
      { amountUsd, amountCop },
      { staffUserId: staff.id }
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code, message: result.message },
        { status: result.code === "PRODUCT_NOT_FOUND" ? 404 : 409 }
      );
    }
    if (result.changed) {
      fireAuditLog({
        staffUserId: staff.id,
        action: "UPDATE",
        entityType: "Product",
        entityId: String(body.id),
        changes: {
          reason: "subscription_price_change",
          amountUsd,
          amountCop,
          grossUsd: result.newGrossUsd,
        },
      });
      await emitPriceChanged(String(body.id));
    }
  }

  try {
    const product = await updateProduct(body.id, {
      title: body.title,
      imageUrl: body.imageUrl !== undefined ? body.imageUrl : undefined,
      sessionsLabel: body.sessionsLabel,
      sessionsCount: body.sessionsCount,
      description: body.description,
      tag: body.tag,
      highlight: body.highlight,
      unitPriceLabel: body.unitPriceLabel,
      therapyHeadline: body.therapyHeadline,
      whatsappMessage: body.whatsappMessage,
      isActive: body.isActive,
      kind: body.kind as ProductKind | undefined,
      // Ya lo aplicó `changeSubscriptionPrice`; volver a mandarlo haría saltar
      // la guarda de `updateProduct`.
      amountUsd: priceGoesThroughSync ? undefined : amountUsd,
      listAmountUsd: priceGoesThroughSync ? undefined : body.listAmountUsd,
      amountCop: priceGoesThroughSync ? undefined : amountCop,
      listAmountCop: priceGoesThroughSync ? undefined : body.listAmountCop,
      sortOrder: body.sortOrder,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "Product",
      entityId: body.id,
      changes: body,
    });

    revalidatePublicCatalog();
    return NextResponse.json({ product });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg === "NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const product = await deactivateProduct(body.id);
    fireAuditLog({
      staffUserId: staff.id,
      action: "DELETE",
      entityType: "Product",
      entityId: body.id,
    });
    revalidatePublicCatalog();
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
