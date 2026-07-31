import { getSiteSetting, setSiteSetting } from "./site-settings";

/**
 * Interruptor por canal del agente (`agent/channels/*.ts`), respaldado por
 * `SiteSetting` — no hace falta una tabla nueva para una fila por canal.
 *
 * Igual que las preferencias de notificación (ver CLAUDE.md): ausencia de
 * fila = valor por defecto, así que un canal nuevo nace habilitado sin
 * necesitar backfill. Apagar un canal ya desplegado es inmediato; añadir uno
 * nuevo (Slack, Discord…) sigue exigiendo el archivo en `agent/channels/` y un
 * deploy — esto no puede saltarse eso, solo evita otro para prender/apagar
 * uno que ya existe.
 */

const channelSettingKey = (channelId: string) => `channel.${channelId}.enabled`;

export const isAgentChannelEnabled = async (
  channelId: string
): Promise<boolean> => {
  const raw = await getSiteSetting(channelSettingKey(channelId));
  return raw !== "false";
};

export const setAgentChannelEnabled = (
  channelId: string,
  enabled: boolean
): Promise<void> => setSiteSetting(channelSettingKey(channelId), String(enabled));
