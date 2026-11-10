import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { writeAuditLog } from "@/lib/crm/audit";
import { FOLLOW_UPS, setLeadFollowUp, type FollowUp } from "@/lib/crm/call-funnel/server";

export const dynamic = "force-dynamic";

type Params = { id: string };

const isFollowUp = (value: unknown): value is FollowUp =>
  typeof value === "string" && (FOLLOW_UPS as readonly string[]).includes(value);

/** El seguimiento a una persona del embudo de la llamada gratis (nuevo · contactada · descartada). */
export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError("not_found", 404);

  const body = (await readJson(req)) as { followUp?: unknown } | null;
  const followUp = body?.followUp;
  if (!isFollowUp(followUp)) return apiError("invalid_follow_up", 400);

  const ok = await setLeadFollowUp(id, followUp);
  if (!ok) return apiError("not_found", 404);

  await writeAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "CallFunnelLead",
    entityId: id,
    changes: { followUp },
  }).catch((e: unknown) => console.warn("[embudo] no se pudo auditar el seguimiento", e));

  return NextResponse.json({ ok: true, followUp });
});
