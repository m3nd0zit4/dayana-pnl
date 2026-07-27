import { defineTool } from "eve/tools";
import { z } from "zod";
import { listConversations } from "@/lib/crm/conversations";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "List the most recent conversations in the Meta inbox (WhatsApp, Instagram, Messenger). Use it to answer 'who wrote today', 'what is pending', or to find a thread before reading it. Returns a summary per thread, not the messages — call get_conversation for those. Threads with no linked contact are normal on Instagram and Messenger, where Meta never gives a phone or email.",
  inputSchema: z.object({
    channel: z.enum(["WHATSAPP", "MESSENGER", "INSTAGRAM"]).optional(),
    status: z.enum(["OPEN", "PENDING", "CLOSED"]).optional(),
    unlinkedOnly: z
      .boolean()
      .optional()
      .describe("Solo hilos sin contacto del CRM vinculado."),
    search: z.string().trim().min(2).max(80).optional(),
  }),
  async execute({ channel, status, unlinkedOnly, search }, ctx) {
    requireStaff(ctx);

    const { items } = await listConversations({
      channel,
      status,
      unlinkedOnly,
      search,
    });

    return {
      count: items.length,
      conversations: items.map((item) => ({
        id: item.id,
        channel: item.channel,
        status: item.status,
        participant:
          item.contact?.displayName ??
          item.participantName ??
          item.externalThreadId,
        contactId: item.contact?.id ?? null,
        unreadCount: item.unreadCount,
        lastMessageAt: item.lastMessageAt.toISOString(),
        lastMessage: item.messages[0]?.body ?? null,
      })),
    };
  },
});
