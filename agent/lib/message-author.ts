import { isAutoSend } from "@/lib/crm/whatsapp-attention-rules";

/**
 * Who wrote one chat message, in words the agents use in their summaries.
 * Without it a summary reads «the AI said X» about something Dayana wrote
 * from her phone, and recommends answering what she already answered
 * (Ailén, 8-nov). Pure (message-author.test.ts).
 */
export type MessageAuthor = "persona" | "IA de WhatsApp" | "envío automático" | "Dayana (desde su teléfono)" | string;

export const messageAuthor = (m: {
  direction: string;
  isAutoReply?: boolean | null;
  source?: string | null;
  clientKey?: string | null;
  staffName?: string | null;
}): MessageAuthor => {
  if (m.direction === "INBOUND") return "persona";
  if (m.isAutoReply && !m.source) return "IA de WhatsApp";
  // An AI proposal Dayana approved in the CRM.
  if (m.source === "approval") return "IA de WhatsApp (aprobado por Dayana)";
  if (isAutoSend({ source: m.source, clientKey: m.clientKey })) return "envío automático";
  if (m.staffName) return `${m.staffName} (desde el CRM)`;
  if (m.isAutoReply) return "IA de WhatsApp";
  return "Dayana (desde su teléfono)";
};

/** «Who wrote last» for a chronological list. */
export const lastWriter = (messages: { author: MessageAuthor }[]): MessageAuthor | null => messages.at(-1)?.author ?? null;
