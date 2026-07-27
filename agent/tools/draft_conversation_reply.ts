import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  getConversation,
  saveConversationDraft,
} from "@/lib/crm/conversations";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Write a suggested reply into a conversation's composer for a human to review. It does NOT send anything — the operator reads the draft, edits it, and presses Send. Never tell the operator the message was sent; say the draft is ready in the inbox. Read the thread with get_conversation first so the draft answers what was actually asked.",
  inputSchema: z.object({
    conversationId: z.string().min(1),
    body: z
      .string()
      .trim()
      .min(5)
      .max(2000)
      .describe(
        "El texto de la respuesta propuesta, en el idioma en que escribe la persona."
      ),
  }),
  approval: always(),
  async execute({ conversationId, body }, ctx) {
    requireWriteStaff(ctx);

    const conversation = await getConversation(conversationId, 1);
    if (!conversation) throw new Error("Esa conversación no existe.");

    // Fuera de la ventana de Meta el operador no podrá enviar texto libre, así
    // que un borrador normal sería una trampa: falla al pulsar Enviar y nadie
    // entiende por qué. Mejor decirlo aquí.
    if (conversation.window.requirement === "closed") {
      throw new Error(
        "Esa conversación está fuera del plazo que Meta permite para responder. Hay que esperar a que la persona escriba de nuevo."
      );
    }
    if (conversation.window.requirement === "template") {
      throw new Error(
        "Pasaron más de 24 h: WhatsApp solo acepta una plantilla aprobada, no un texto libre. Avisa al operador en vez de dejar un borrador que no podrá enviar."
      );
    }

    const saved = await saveConversationDraft(conversationId, body, "AGENT");

    await auditAgentWrite(ctx, {
      action: "DRAFT_CONVERSATION_REPLY",
      entityType: "Conversation",
      entityId: conversationId,
      changes: { chars: body.length, channel: conversation.channel },
    });

    return {
      conversationId: saved.id,
      draftSaved: true,
      sent: false,
      href: `/admin/inbox`,
      note: "El borrador quedó listo en la bandeja. NO se envió: lo revisa y lo manda una persona.",
    };
  },
});
