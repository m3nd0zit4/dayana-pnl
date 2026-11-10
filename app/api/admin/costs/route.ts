import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { parseBillInput } from "@/lib/crm/costs/rules";
import { createBill, getCostsMonth } from "@/lib/crm/costs/store";

export const dynamic = "force-dynamic";

/** Los costos de un mes (`?mes=YYYY-MM`; sin él, el mes actual). Solo la dueña. */
export const GET = withStaff("owner", async ({ req }) => {
  const costs = await getCostsMonth(req.nextUrl.searchParams.get("mes"));
  return NextResponse.json({ costs });
});

/** Registra una factura o suscripción. */
export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = parseBillInput(await readJson(req));
  if (!parsed.ok) return apiError(parsed.error, 400);

  const bill = await createBill(parsed.data, staff.id);
  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "PlatformCost",
    entityId: bill.id,
    changes: parsed.data,
  });
  return NextResponse.json({ bill });
});
