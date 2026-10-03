import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { getMemory } from "@/lib/crm/whatsapp-agent/memory";
import { listChats } from "@/lib/crm/whatsapp-agent/workspace";

export default defineTool({
  description:
    "Find WhatsApp chats by name or number (a query always searches ALL chats, whatever the queue), or list a queue: attention («Te toca»: chats that need Dayana now — an AI hand-off, a message nobody else will answer, or something waiting for her approval; a chat leaves as soon as she replies from the CRM or her phone, or marks it «Listo»), seguimiento (people who wrote, went quiet for 2+ days and haven't booked or paid), mine (mode «Yo» or starred), ai (the AI is handling them). Returns who handles each chat, why it needs Dayana (attention), its AI status and what the AI remembers about the person.",
  inputSchema: z.object({
    query: z.string().trim().max(80).optional(),
    queue: z.enum(["attention", "seguimiento", "mine", "ai", "all"]).optional(),
  }),
  async execute({ query, queue }, ctx) {
    requireStaff(ctx);
    const chats = await listChats({ queue: queue ?? "all", q: query, take: 15 });
    return Promise.all(
      chats.map(async (c) => ({
        conversationId: c.id,
        name: c.name,
        phone: c.phone,
        mode: c.aiMode,
        paused: c.paused,
        priority: c.priority,
        attention: c.attention,
        awaitingApproval: c.awaitingApproval,
        escalation: c.escalation,
        replyState: c.replyState,
        lastMessage: c.lastMessage?.slice(0, 200),
        lastMessageAt: c.lastMessageAt,
        aiStatus: c.lastRun ? { status: c.lastRun.status, reason: c.lastRun.reason } : null,
        memory: await getMemory(c.phone),
        link: `/admin/whatsapp?conversation=${c.id}`,
      }))
    );
  },
});
