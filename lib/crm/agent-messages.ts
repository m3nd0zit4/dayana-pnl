import { randomBytes } from "node:crypto";
import { isAgentId, type AgentId } from "@/agent/lib/catalog";
import { prisma } from "@/lib/db";
import { getPendientes } from "@/lib/crm/pendientes";
import { getSiteSettingBoolean } from "@/lib/crm/site-settings";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";
import { getAgentVoiceSettings } from "@/lib/voice/settings";
import { sendOwnerVoiceNote } from "@/lib/voice/owner-voice-note";

/**
 * The panel assistant starting a conversation with Dayana. A message becomes
 * an `AGENT_MESSAGE` notification (bell + push); opening it opens the panel
 * on a new thread with that agent, the message shown as the agent's first
 * line, and her reply goes to the agent with that message as context.
 *
 * No table of its own: the notification row is the message (entity
 * `AgentMessage`, a random key, the text and agent in `metadata`).
 */

export const AGENT_MESSAGE_ENTITY = "AgentMessage";
export const AGENT_MESSAGE_MAX = 1200;

export type AgentMessageSeed = { key: string; agent: AgentId; title: string; message: string; createdAt: string; source: string };

const newKey = () => randomBytes(9).toString("base64url");

/** Who gets it: the OWNERs (the catalog's audience for this type). */
export const startOwnerConversation = async (input: {
  agent: AgentId;
  title: string;
  message: string;
  /** What started it: `tool:<agent>`, `mcp:<tokenId>`, `brief`. Kept in metadata for the audit trail. */
  source: string;
}): Promise<{ key: string; notificationId: string | null; href: string }> => {
  const key = newKey();
  const message = input.message.trim().slice(0, AGENT_MESSAGE_MAX);
  const href = `/admin?agentMessage=${key}`;
  const notificationId = await emitPlatformNotification({
    eventType: "AGENT_MESSAGE",
    title: input.title.trim().slice(0, 120) || "El asistente te escribió",
    body: message.length > 240 ? `${message.slice(0, 237)}…` : message,
    href,
    entityType: AGENT_MESSAGE_ENTITY,
    entityId: key,
    metadata: { agent: input.agent, message, source: input.source },
    staff: "ALL",
  });
  await alsoAsVoiceNote(key, input);
  return { key, notificationId, href };
};

/**
 * Si Dayana lo pidió en Ajustes («también como nota de voz»), el mismo mensaje
 * le llega leído a su WhatsApp. Nunca para la respuesta de una llamada (ya
 * estaba al teléfono). Un fallo aquí no tumba el aviso de la campana.
 */
const alsoAsVoiceNote = async (key: string, input: { title: string; message: string; source: string }) => {
  if (input.source.startsWith("call:")) return;
  try {
    const voice = await getAgentVoiceSettings();
    if (!voice.voiceNotes || !voice.voiceNotesProactive) return;
    const result = await sendOwnerVoiceNote({
      text: `${input.title.trim()}. ${input.message.trim()}`,
      reason: "proactive",
      source: `aviso:${key}`,
    });
    if (!result.sent && result.reason !== "quiet_hours") console.warn(`[agent-messages] nota de voz no enviada: ${result.detail}`);
  } catch (err) {
    console.warn("[agent-messages] nota de voz falló", err);
  }
};

/** The message behind a notification, only for a staff member who received it. */
export const getAgentMessageSeed = async (key: string, staffUserId: string): Promise<AgentMessageSeed | null> => {
  const row = await prisma.platformNotification.findFirst({
    where: {
      entityType: AGENT_MESSAGE_ENTITY,
      entityId: key,
      recipients: { some: { staffUserId } },
    },
    select: { title: true, metadata: true, createdAt: true },
  });
  if (!row) return null;
  const meta = (row.metadata ?? {}) as { agent?: unknown; message?: unknown; source?: unknown };
  return {
    key,
    agent: isAgentId(meta.agent) ? meta.agent : "auto",
    title: row.title,
    message: typeof meta.message === "string" ? meta.message : "",
    createdAt: row.createdAt.toISOString(),
    source: typeof meta.source === "string" ? meta.source : "",
  };
};

/**
 * The morning check-in: what is waiting, as a question. Off unless the
 * `agent.brief.enabled` setting is on. Nothing waiting → nothing sent.
 */
export const AGENT_BRIEF_SETTING = "agent.brief.enabled";

export const morningBriefText = (items: { label: string; count: number; tone: "alert" | "todo" }[]): string | null => {
  const waiting = items.filter((i) => i.count > 0);
  if (waiting.length === 0) return null;
  const ordered = [...waiting.filter((i) => i.tone === "alert"), ...waiting.filter((i) => i.tone !== "alert")];
  const lines = ordered.slice(0, 6).map((i) => `- ${i.label}`);
  return ["Buenos días. Esto te está esperando hoy:", ...lines, "", "¿Por cuál quieres que empecemos?"].join("\n");
};

export const sendMorningBrief = async (): Promise<{ sent: boolean; reason?: string }> => {
  if ((await getSiteSettingBoolean(AGENT_BRIEF_SETTING)) !== true) return { sent: false, reason: "off" };
  const text = morningBriefText(await getPendientes());
  if (!text) return { sent: false, reason: "nothing" };
  await startOwnerConversation({ agent: "auto", title: "Tu resumen de hoy", message: text, source: "brief" });
  return { sent: true };
};
