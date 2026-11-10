import { getSiteSetting, setSiteSetting } from "../site-settings";
import { DEFAULT_FUNNEL_CONFIG, parseFunnelConfig, type CallFunnelConfig } from "./rules";

/** Los ajustes de la página de la llamada gratis (`site_settings`, clave `call.funnel`). */
export const CALL_FUNNEL_SETTING_KEY = "call.funnel";

export const getCallFunnelConfig = async (): Promise<CallFunnelConfig> => {
  try {
    const raw = await getSiteSetting(CALL_FUNNEL_SETTING_KEY);
    return raw ? parseFunnelConfig(JSON.parse(raw)) : DEFAULT_FUNNEL_CONFIG;
  } catch {
    // Sin base o con un JSON roto: los valores de siempre.
    return DEFAULT_FUNNEL_CONFIG;
  }
};

/** Guarda solo lo que se le pasa; lo demás queda como estaba. */
export const setCallFunnelConfig = async (patch: Partial<CallFunnelConfig>): Promise<CallFunnelConfig> => {
  const next = parseFunnelConfig({ ...(await getCallFunnelConfig()), ...patch });
  await setSiteSetting(CALL_FUNNEL_SETTING_KEY, JSON.stringify(next));
  return next;
};
