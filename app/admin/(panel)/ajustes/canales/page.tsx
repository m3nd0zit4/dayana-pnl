import AgentChannelsClient from "@/app/components/admin/crm/settings/AgentChannelsClient";
import WhatsAppWelcomeCard from "@/app/components/admin/crm/settings/WhatsAppWelcomeCard";
import WhatsAppProviderCard from "@/app/components/admin/crm/settings/WhatsAppProviderCard";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { isAgentChannelEnabled } from "@/lib/crm/agent-channels";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import { getWelcomeConfig } from "@/lib/crm/whatsapp-welcome";
import {
  getWhatsAppProviderSummary,
  resolveWhatsAppCredentials,
} from "@/lib/meta/whatsapp-provider";
import {
  getAgentEnabledOverride,
  resolveAgentEnabled,
} from "@/lib/agent/resolve-agent-enabled";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  const [enabled, whatsAppAuto, welcome, agentEnabled, agentEnabledOverride] =
    await Promise.all([
      isAgentChannelEnabled("eve"),
      isWhatsAppAutoReplyEnabled(),
      getWelcomeConfig(),
      resolveAgentEnabled(),
      getAgentEnabledOverride(),
    ]);

  // Lo decide el proveedor elegido en el CRM (Meta directo o 360dialog), no
  // solo las variables de entorno.
  const [providerSummary, whatsAppCredentials] = await Promise.all([
    getWhatsAppProviderSummary(),
    resolveWhatsAppCredentials(),
  ]);
  const whatsAppConfigured = whatsAppCredentials !== null;

  return (
    <>
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
            : "Falta conectar WhatsApp: elige el proveedor y su clave aquí abajo.",
          enabled: whatsAppAuto,
          agentEnabled: whatsAppConfigured,
          allowLocalDevAuth: false,
        },
      ]}
    />
    <WhatsAppProviderCard initial={providerSummary} />
    <WhatsAppWelcomeCard initial={welcome} configured={whatsAppConfigured} />
    </>
  );
};

export default Page;
