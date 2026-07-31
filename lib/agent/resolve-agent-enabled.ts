import { isAgentEnabled } from "./is-agent-enabled";
import { getSiteSettingBoolean, setSiteSettingBoolean } from "@/lib/crm/site-settings";

export const AGENT_ENABLED_OVERRIDE_KEY = "agent.enabled.override";

/** Override en BD > `CRM_AGENT_ENABLED`. `null`/sin fila = automático (entorno). */
export const resolveAgentEnabled = async (): Promise<boolean> => {
  try {
    const override = await getSiteSettingBoolean(AGENT_ENABLED_OVERRIDE_KEY);
    if (override != null) return override;
  } catch {
    /* DB no disponible */
  }
  return isAgentEnabled();
};

export const setAgentEnabledOverride = (value: boolean | null): Promise<void> =>
  setSiteSettingBoolean(AGENT_ENABLED_OVERRIDE_KEY, value);

/** Fila cruda (sin fusionar con el entorno), para que la UI distinga "automático" de un override explícito. */
export const getAgentEnabledOverride = (): Promise<boolean | null> =>
  getSiteSettingBoolean(AGENT_ENABLED_OVERRIDE_KEY);
