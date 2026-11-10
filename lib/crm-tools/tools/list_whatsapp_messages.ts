import { defineTool } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { requireStaff } from "@/lib/crm-tools/guard";
import { prisma } from "@/lib/db";
import { messageAuthor } from "@/lib/crm-tools/message-author";

const BODY_MAX = 1500;

/** Quién escribió: the same words as get_conversation (`agent/lib/message-author.ts`). */
const author = (m: {
  direction: string;
  isAutoReply: boolean;
  kind: string;
  source: string | null;
  clientKey: string | null;
  staffUser: { displayName: string } | null;
}) =>
  m.kind === "system"
    ? "sistema"
    : messageAuthor({
        direction: m.direction,
        isAutoReply: m.isAutoReply,
        source: m.source,
        clientKey: m.clientKey,
        staffName: m.staffUser?.displayName ?? null,
      });

export default defineTool({
  description:
    "Page through the messages of ONE WhatsApp (or Instagram/Messenger) conversation, newest page first but each page in chronological order. Use `before` (the `nextBefore` of the previous page) to go further back. `from` says who wrote: persona (the customer), IA de WhatsApp, Dayana (desde su teléfono), <name> (desde el CRM), envío automático (bulk, reminders), sistema. get_conversation gives a quick summary; this one is for reading history.",
  inputSchema: z.object({
    conversationId: z.string().min(1),
    before: z.string().datetime().optional().describe("ISO timestamp: only messages sent before it"),
    limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
  }),
  async execute({ conversationId, before, limit = 30 }, ctx) {
    requireStaff(ctx);
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        channel: true,
        participantName: true,
        externalThreadId: true,
        contactId: true,
        lastInboundAt: true,
      },
    });
    if (!conversation) return { found: false as const };

    const rows = await prisma.conversationMessage.findMany({
      where: { conversationId, ...(before ? { sentAt: { lt: new Date(before) } } : {}) },
      orderBy: { sentAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        direction: true,
        status: true,
        body: true,
        attachments: true,
        isAutoReply: true,
        kind: true,
        source: true,
        clientKey: true,
        sentAt: true,
        readAt: true,
        failedReason: true,
        revokedAt: true,
        editedAt: true,
        staffUser: { select: { displayName: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse();

    return {
      found: true as const,
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        participant: conversation.participantName ?? conversation.externalThreadId,
        lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
        ref: {
          type: "conversation" as const,
          id: conversation.id,
          href: `/admin/whatsapp?conversation=${conversation.id}`,
        },
        contactRef: conversation.contactId
          ? { type: "contact" as const, id: conversation.contactId, href: `/admin/contacts/${conversation.contactId}` }
          : null,
      },
      messages: page.map((m) => {
        const attachments = Array.isArray(m.attachments) ? m.attachments : [];
        const body = m.body ?? "";
        return {
          id: m.id,
          from: author(m),
          sentAt: m.sentAt.toISOString(),
          body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}…` : body,
          ...(attachments.length
            ? {
                attachments: attachments.map((a) =>
                  a && typeof a === "object" && "type" in a ? String((a as { type: unknown }).type) : "file"
                ),
              }
            : {}),
          status: m.status,
          ...(m.readAt ? { read: true } : {}),
          ...(m.failedReason ? { failedReason: m.failedReason } : {}),
          ...(m.revokedAt ? { deleted: true } : {}),
          ...(m.editedAt ? { edited: true } : {}),
        };
      }),
      hasMore,
      nextBefore: hasMore ? (page[0]?.sentAt.toISOString() ?? null) : null,
    };
  },
});
