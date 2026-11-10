import { defineTool } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { getCallerStaff } from "@/lib/crm-tools/guard";
import { catalogEntry } from "@/lib/notifications/platform/catalog";
import { listFeed } from "@/lib/notifications/platform/feed";

export default defineTool({
  description:
    "Read the caller's own notification feed (the bell in the CRM top bar): payment alerts, WhatsApp escalations («Te toca»), system alerts, newest first, 20 per page. Read-only: it does not mark anything as read. Use `nextCursor` to page.",
  inputSchema: z.object({
    unreadOnly: z.boolean().optional(),
    cursor: z.string().datetime().optional().describe("`nextCursor` from the previous page"),
  }),
  async execute({ unreadOnly, cursor }, ctx) {
    const { staffId } = getCallerStaff(ctx);
    const feed = await listFeed({ staffUserId: staffId }, { unreadOnly, cursor });
    return {
      unread: feed.unread,
      nextCursor: feed.nextCursor,
      items: feed.items.map((item) => ({
        id: item.id,
        type: item.eventType,
        kind: catalogEntry(item.eventType)?.label ?? item.eventType,
        severity: item.severity,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
        read: item.readAt !== null,
        ...(item.href ? { href: item.href } : {}),
      })),
    };
  },
});
