import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { getMemory } from "@/lib/crm/whatsapp-agent/memory";
import { listChats } from "@/lib/crm/whatsapp-agent/workspace";

export default defineTool({
  description:
    "Find WhatsApp chats by name or number, or list a queue: attention (the AI handed them to Dayana), mine (Dayana took them), ai (the AI is handling them). Returns who handles each chat, its AI status and what the AI remembers about the person.",
  inputSchema: z.object({
    query: z.string().trim().max(80).optional(),
    queue: z.enum(["attention", "mine", "ai", "all"]).optional(),
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
        escalation: c.escalation,
        lastMessage: c.lastMessage?.slice(0, 200),
        lastMessageAt: c.lastMessageAt,
        aiStatus: c.lastRun ? { status: c.lastRun.status, reason: c.lastRun.reason } : null,
        memory: await getMemory(c.phone),
        link: `/admin/whatsapp?conversation=${c.id}`,
      }))
    );
  },
});
