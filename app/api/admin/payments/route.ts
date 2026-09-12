import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { listPayments } from "@/lib/crm/payments-list";

export const dynamic = "force-dynamic";

const asStatus = (raw: string | null): PaymentStatus | "all" | undefined => {
  if (!raw || raw === "all") return "all";
  return (Object.values(PaymentStatus) as string[]).includes(raw)
    ? (raw as PaymentStatus)
    : undefined;
};

const asProvider = (raw: string | null): PaymentProvider | "all" | undefined => {
  if (!raw || raw === "all") return "all";
  return (Object.values(PaymentProvider) as string[]).includes(raw)
    ? (raw as PaymentProvider)
    : undefined;
};

/**
 * Delgado a propósito (CLAUDE.md, "CRM lib conventions"): toda consulta vive
 * en `lib/crm/payments-list.ts`, nunca aquí. Antes esta ruta llamaba a Prisma
 * directamente.
 */
export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const params = req.nextUrl.searchParams;

  const status = asStatus(params.get("status"));
  const provider = asProvider(params.get("provider"));
  if (status === undefined || provider === undefined) {
    return NextResponse.json({ error: "invalid_filter" }, { status: 400 });
  }

  const result = await listPayments({
    q: params.get("q") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    status,
    provider,
    productId: params.get("productId") ?? undefined,
    // `?unidentified=1` es a donde apunta el aviso del panel: sirve la misma
    // lista ya filtrada en vez de obligar a buscarlos a ojo entre las filas.
    unidentified: params.get("unidentified") === "1",
    cursor: params.get("cursor"),
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  });

  return NextResponse.json(result);
}
