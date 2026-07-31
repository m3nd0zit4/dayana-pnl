import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { setAgentChannelEnabled } from "@/lib/crm/agent-channels";

export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    enabled?: boolean;
  } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await setAgentChannelEnabled(id, body.enabled);

  fireAuditLog({
    staffUserId: staff.id,
    action: body.enabled ? "AGENT_CHANNEL_ENABLED" : "AGENT_CHANNEL_DISABLED",
    entityType: "AgentChannel",
    entityId: id,
    changes: { enabled: body.enabled },
  });

  return NextResponse.json({ ok: true });
};
