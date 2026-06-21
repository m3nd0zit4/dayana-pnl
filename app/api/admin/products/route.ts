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
  if (!body?.title || !body?.kind || body?.amountUsd == null) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const product = await createProduct({
      id: body.id,
      kind: body.kind as ProductKind,
      title: body.title,
      sessionsLabel: body.sessionsLabel ?? body.title,
      sessionsCount: body.sessionsCount ?? null,
      description: body.description,
      amountUsd: Number(body.amountUsd),
      listAmountUsd:
        body.listAmountUsd != null ? Number(body.listAmountUsd) : null,
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

  const body = await req.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const product = await updateProduct(body.id, {
      title: body.title,
      sessionsLabel: body.sessionsLabel,
      sessionsCount: body.sessionsCount,
      description: body.description,
      isActive: body.isActive,
      kind: body.kind as ProductKind | undefined,
      amountUsd: body.amountUsd != null ? Number(body.amountUsd) : undefined,
      listAmountUsd:
        body.listAmountUsd !== undefined
          ? body.listAmountUsd != null
            ? Number(body.listAmountUsd)
            : null
          : undefined,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
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
