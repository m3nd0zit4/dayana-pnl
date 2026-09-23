import AgentChannelsClient from "@/app/components/admin/crm/settings/AgentChannelsClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { isAgentChannelEnabled } from "@/lib/crm/agent-channels";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import {
  getAgentEnabledOverride,
  resolveAgentEnabled,
} from "@/lib/agent/resolve-agent-enabled";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  const [enabled, whatsAppAuto, agentEnabled, agentEnabledOverride] =
    await Promise.all([
      isAgentChannelEnabled("eve"),
      isWhatsAppAutoReplyEnabled(),
      resolveAgentEnabled(),
      getAgentEnabledOverride(),
    ]);

  const whatsAppConfigured = Boolean(
    process.env.WHATSAPP_API_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  );

  return (
    <AgentChannelsClient
      globalEnabled={agentEnabled}
      globalOverride={agentEnabledOverride}
      channels={[
        {
          id: "eve",
          label: "Panel web (CRM)",
          description:
            "El chat del asistente dentro del panel de administración. Solo OWNER puede entrar.",
          enabled,
          agentEnabled,
          allowLocalDevAuth: process.env.CRM_AGENT_LOCAL_DEV_AUTH === "true",
        },
        {
          id: "whatsapp",
          label: "WhatsApp (respuesta automática)",
          description: whatsAppConfigured
            ? "Contesta el primer mensaje con precios, enlaces y horarios sacados del CRM. En cuanto la conversación se pone personal —dolor, un pago, una queja, algo que no sabe— deja de escribir, te avisa y el hilo queda para ti."
            : "Falta conectar WhatsApp: sin WHATSAPP_API_TOKEN y WHATSAPP_PHONE_NUMBER_ID no puede escribir aunque lo enciendas.",
          enabled: whatsAppAuto,
          agentEnabled: whatsAppConfigured,
          allowLocalDevAuth: false,
        },
      ]}
    />
  );
};

export default Page;
