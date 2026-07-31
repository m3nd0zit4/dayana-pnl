import AgentChannelsClient from "@/app/components/admin/crm/settings/AgentChannelsClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { isAgentChannelEnabled } from "@/lib/crm/agent-channels";
import {
  getAgentEnabledOverride,
  resolveAgentEnabled,
} from "@/lib/agent/resolve-agent-enabled";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();

  const [enabled, agentEnabled, agentEnabledOverride] = await Promise.all([
    isAgentChannelEnabled("eve"),
    resolveAgentEnabled(),
    getAgentEnabledOverride(),
  ]);

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
      ]}
    />
  );
};

export default Page;
