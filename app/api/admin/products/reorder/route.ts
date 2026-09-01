import { NextRequest, NextResponse } from "next/server";

import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { reorderProducts } from "@/lib/crm/products-admin";
import { revalidatePublicCatalog } from "@/lib/crm/revalidate-catalog";
import { canManageTeam } from "@/lib/crm/staff";
import { reorderProductsSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

/**
 * Reordena el catálogo. Mismo contrato que los módulos del curso: llega la
 * lista entera de ids en su orden nuevo, no un "sube este uno". Así dos
 * pestañas abiertas no pueden dejar el orden a medias.
 */
export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = reorderProductsSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await reorderProducts(parsed.data.orderedIds);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "Product",
    entityId: "reorder",
    changes: { orderedIds: parsed.data.orderedIds },
  });

  revalidatePublicCatalog();
  return NextResponse.json({ ok: true });
}
