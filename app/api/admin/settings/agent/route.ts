import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { setAgentEnabledOverride } from "@/lib/agent/resolve-agent-enabled";

export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const body = (await readJson(req)) as {
    enabled?: boolean | null;
  } | null;
  if (!body || (typeof body.enabled !== "boolean" && body.enabled !== null)) {
    return apiError("invalid_body", 400);
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
});
