import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { setAgentEnabledOverride } from "@/lib/agent/resolve-agent-enabled";

export const PATCH = async (request: Request) => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const body = (await request.json().catch(() => null)) as {
    enabled?: boolean | null;
  } | null;
  if (!body || (typeof body.enabled !== "boolean" && body.enabled !== null)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await setAgentEnabledOverride(body.enabled);

  fireAuditLog({
    staffUserId: staff.id,
    action:
      body.enabled === null
        ? "AGENT_ENABLED_OVERRIDE_RESET"
        : body.enabled
          ? "AGENT_ENABLED_OVERRIDE_ON"
          : "AGENT_ENABLED_OVERRIDE_OFF",
    entityType: "SiteSetting",
    entityId: "agent_enabled_override",
    changes: { enabled: body.enabled },
  });

  return NextResponse.json({ ok: true });
};
