import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";
import { prisma } from "@/lib/db";
import { resumeAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { setMemory } from "@/lib/crm/whatsapp-agent/memory";

export default defineTool({
  description:
    "Change who handles one WhatsApp chat — AUTO (the AI answers alone), COPILOT (the AI drafts, Dayana sends), MANUAL (only Dayana) — mark it as priority, resume the AI after a hand-off, or rewrite what the AI remembers about that person (memory). Find the chat first with whatsapp_find_chat.",
  inputSchema: z.object({
    conversationId: z.string(),
    mode: z.enum(["AUTO", "COPILOT", "MANUAL"]).optional(),
    priority: z.boolean().optional(),
    resume: z
      .boolean()
      .optional()
      .describe("Quita la pausa o escalada para que la IA vuelva a contestar."),
    memory: z.string().max(1500).optional().describe("Nueva ficha completa de la persona."),
  }),
  approval: always(),
  async execute({ conversationId, mode, priority, resume, memory }, ctx) {
    requireWriteStaff(ctx);
    const chat = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channel: true, externalThreadId: true, contactId: true },
    });
    if (!chat || chat.channel !== "WHATSAPP") throw new Error("Ese chat de WhatsApp no existe.");
    if (mode || priority !== undefined) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          ...(mode ? { aiMode: mode } : {}),
          ...(priority === undefined ? {} : { priorityAt: priority ? new Date() : null }),
        },
      });
    }
    if (resume || (mode && mode !== "MANUAL")) await resumeAutoReply(conversationId);
    if (memory !== undefined) await setMemory(chat.externalThreadId, memory, chat.contactId);
    await auditAgentWrite(ctx, {
      action: "WHATSAPP_CHAT_UPDATED",
      entityType: "WhatsAppChat",
      entityId: conversationId,
      changes: { mode, priority, resume, memory: memory !== undefined },
    });
    return { ok: true, link: `/admin/whatsapp?conversation=${conversationId}` };
  },
});
