import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { parseBillInput } from "@/lib/crm/costs/rules";
import { deleteBill, updateBill } from "@/lib/crm/costs/store";

type Params = { id: string };

export const dynamic = "force-dynamic";

export const PATCH = withStaff<Params>("owner", async ({ req, staff, params }) => {
  const parsed = parseBillInput(await readJson(req));
  if (!parsed.ok) return apiError(parsed.error, 400);

  const bill = await updateBill(params.id, parsed.data);
  if (!bill) return apiError("not_found", 404);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "PlatformCost",
    entityId: bill.id,
    changes: parsed.data,
  });
  return NextResponse.json({ bill });
});

export const DELETE = withStaff<Params>("owner", async ({ staff, params }) => {
  if (!(await deleteBill(params.id))) return apiError("not_found", 404);

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "PlatformCost",
    entityId: params.id,
  });
  return NextResponse.json({ ok: true });
});
