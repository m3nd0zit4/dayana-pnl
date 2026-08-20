import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { canManageTeam } from "@/lib/crm/staff";
import { verifyProductPriceSync } from "@/lib/pricing/price-sync";

export const dynamic = "force-dynamic";

/**
 * «Verificar ahora»: pregunta a PayPal y a Mercado Pago cuánto cobran de verdad
 * y lo compara con el precio del CRM. Es el mismo trabajo que hace el cron
 * diario, disponible a mano para no tener que esperar a mañana.
 */
export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const result = await verifyProductPriceSync(id);
  return NextResponse.json(result);
}
