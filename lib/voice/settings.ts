import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";
import { whatsAppDigits } from "@/lib/whatsapp-contact";
import { AGENT_VOICE_SETTING, parseAgentVoiceSettings, type AgentVoiceSettings } from "./settings-rules";

export const getAgentVoiceSettings = async (): Promise<AgentVoiceSettings> =>
  parseAgentVoiceSettings(await getSiteSetting(AGENT_VOICE_SETTING));

export const saveAgentVoiceSettings = async (next: AgentVoiceSettings): Promise<AgentVoiceSettings> => {
  const clean = parseAgentVoiceSettings(JSON.stringify(next));
  await setSiteSetting(AGENT_VOICE_SETTING, JSON.stringify(clean));
  return clean;
};

/** Categorías de chat a las que sí se le puede mandar la voz del asistente. */
const OWN_CATEGORIES = new Set(["personal", "equipo"]);

/**
 * El número de Dayana no puede ser el chat de una clienta: si ya existe un chat
 * de trabajo con ese número, se rechaza (una nota de voz del asistente le
 * llegaría a una persona real que no es ella).
 */
export const ownerPhoneProblem = async (phoneE164: string): Promise<string | null> => {
  const conv = await prisma.conversation.findUnique({
    where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: whatsAppDigits(phoneE164) } },
    select: { category: true, contactId: true },
  });
  if (!conv) return null;
  if (conv.category && !OWN_CATEGORIES.has(conv.category)) {
    return "Ese número ya es un chat de trabajo en WhatsApp (clienta o interesada). Pon tu número personal.";
  }
  return null;
};
