import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { setAgentChannelEnabled } from "@/lib/crm/agent-channels";
import { setWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";

type Params = { id: string };

export const PATCH = withStaff<Params>("owner", async ({ req, staff, params }) => {
  const { id } = params;
  const body = (await readJson(req)) as {
    enabled?: boolean;
  } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return apiError("invalid_body", 400);
  }

  // «whatsapp» no es un canal del asistente del panel: es la respuesta
  // automática a clientas, con su propio interruptor apagado por defecto.
  if (id === "whatsapp") {
    await setWhatsAppAutoReplyEnabled(body.enabled);
  } else {
    await setAgentChannelEnabled(id, body.enabled);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: body.enabled ? "AGENT_CHANNEL_ENABLED" : "AGENT_CHANNEL_DISABLED",
    entityType: "AgentChannel",
    entityId: id,
    changes: { enabled: body.enabled },
  });

  return NextResponse.json({ ok: true });
});
