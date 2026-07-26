import { defineTool } from "eve/tools";
import { z } from "zod";
import { getConversation } from "@/lib/crm/conversations";
import { requireStaff } from "@/agent/lib/guard";

/** Cuántos mensajes ve el modelo. El hilo completo puede ser enorme. */
const MODEL_MESSAGE_LIMIT = 20;

export default defineTool({
  description:
    "Read one conversation from the Meta inbox: the recent messages, the linked contact if any, and whether Meta's 24-hour reply window is still open. Read the thread with this before drafting a reply, so the draft actually answers what the person asked.",
  inputSchema: z.object({
    conversationId: z.string().min(1),
  }),
  async execute({ conversationId }, ctx) {
    requireStaff(ctx);

    const conversation = await getConversation(conversationId);
    if (!conversation) throw new Error("Esa conversación no existe.");

    return {
      id: conversation.id,
      channel: conversation.channel,
      status: conversation.status,
      participant:
        conversation.contact?.displayName ??
        conversation.participantName ??
        conversation.externalThreadId,
      contactId: conversation.contact?.id ?? null,
      contactPhone: conversation.contact?.phoneE164 ?? null,
      // Que la ventana esté cerrada cambia lo que el asistente debe proponer:
      // fuera de ella solo cabe una plantilla aprobada, no texto libre.
      window: conversation.window,
      windowNotice: conversation.windowNotice,
      existingDraft: conversation.draftBody,
      messages: conversation.messages.map((message) => ({
        direction: message.direction,
        body: message.body,
        sentAt: message.sentAt.toISOString(),
        sentBy: message.staffUser?.displayName ?? null,
      })),
    };
  },
  toModelOutput(output) {
    // El canal y los hooks ven el payload completo; al modelo se le entrega
    // solo la cola del hilo para no gastar la ventana de contexto en historia.
    return {
      type: "json",
      value: {
        ...output,
        messages: output.messages.slice(-MODEL_MESSAGE_LIMIT),
        truncated: output.messages.length > MODEL_MESSAGE_LIMIT,
      },
    };
  },
});
