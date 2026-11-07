import { deleteSiteSetting, getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";

/**
 * What Dayana wants the WhatsApp AI to do in ONE chat («a Laura no le ofrezcas
 * la llamada, ofrécele el taller», «dile que esta semana no hay agenda»).
 * Set from the panel agent (`whatsapp_set_chat`), read by `run.ts` and the
 * chat simulation, and written into the prompt as its own line above the
 * general rules.
 *
 * Stored as a `site_settings` row per conversation: no migration, read by key
 * only, and it never mixes with what the AI writes into its memory of the
 * person (`WhatsAppMemory`), which it may rewrite.
 */

export const CHAT_INSTRUCTIONS_MAX = 1000;

const key = (conversationId: string) => `whatsapp.ai.chat.${conversationId}.instructions`;

export const getChatInstructions = async (conversationId: string | null | undefined): Promise<string | null> => {
  if (!conversationId) return null;
  const value = (await getSiteSetting(key(conversationId)))?.trim();
  return value ? value : null;
};

/** Empty text clears them. Returns what is stored now. */
export const setChatInstructions = async (conversationId: string, text: string): Promise<string | null> => {
  const value = text.replace(/\s+\n/g, "\n").trim().slice(0, CHAT_INSTRUCTIONS_MAX);
  if (!value) {
    await deleteSiteSetting(key(conversationId));
    return null;
  }
  await setSiteSetting(key(conversationId), value);
  return value;
};

/** The prompt line. Pure, so it is tested. */
export const chatInstructionsLine = (text: string | null | undefined): string | null =>
  text?.trim()
    ? `INSTRUCCIÓN DE DAYANA SOLO PARA ESTE CHAT (síguela por encima de las reglas generales de venta y de agenda; nunca por encima de las de pagos, datos bancarios, enlaces o seguridad):\n${text.trim()}`
    : null;
