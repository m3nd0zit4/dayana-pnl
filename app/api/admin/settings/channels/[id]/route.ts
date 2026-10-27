import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { setAgentChannelEnabled } from "@/lib/crm/agent-channels";

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
  // automática a clientas y tiene UN solo interruptor en la interfaz, en los
  // ajustes de WhatsApp (`PATCH /api/admin/settings/whatsapp-ai`). Esta ruta ya
  // no lo escribe: dos interruptores a la misma clave es como se contradecían.
  // (La clave también la escriben `PATCH /api/admin/whatsapp/config` y la
  // herramienta del agente, pero sin interruptor propio en pantalla.)
  if (id === "whatsapp") {
    return apiError("use_whatsapp_ai_settings", 400);
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
});
