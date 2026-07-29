import type {
  ConversationDetail,
  listConversations,
} from "@/lib/crm/conversations";
import type {
  ConversationDetailView,
  ConversationListItem,
  InboxChannel,
  InboxStatus,
  MessageAttachment,
} from "./types";

/**
 * Paso de fila de Prisma a lo que viaja al cliente.
 *
 * Vive aparte de las páginas porque lo usan tres sitios (la lista, el hilo
 * profundo y la ruta de API) y duplicarlo es cómo se acaban devolviendo formas
 * distintas para lo mismo.
 */

type ListRow = Awaited<ReturnType<typeof listConversations>>["items"][number];

export const toListItem = (row: ListRow): ConversationListItem => ({
  id: row.id,
  channel: row.channel as InboxChannel,
  status: row.status as InboxStatus,
  participantName: row.participantName,
  participantHandle: row.participantHandle,
  participantAvatarUrl: row.participantAvatarUrl,
  externalThreadId: row.externalThreadId,
  lastMessageAt: row.lastMessageAt.toISOString(),
  unreadCount: row.unreadCount,
  contact: row.contact,
  assignedStaff: row.assignedStaff,
  lastMessage: row.messages[0]
    ? { body: row.messages[0].body, direction: row.messages[0].direction }
    : null,
});

const readAttachments = (value: unknown): MessageAttachment[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const a = entry as Record<string, unknown>;
    return [
      {
        kind: typeof a.kind === "string" ? a.kind : "unknown",
        url: typeof a.url === "string" ? a.url : null,
        mimeType: typeof a.mimeType === "string" ? a.mimeType : null,
        caption: typeof a.caption === "string" ? a.caption : null,
        unavailableReason:
          typeof a.unavailableReason === "string"
            ? a.unavailableReason
            : undefined,
      },
    ];
  });
};

export const toDetailView = (
  conversation: ConversationDetail
): ConversationDetailView => ({
  id: conversation.id,
  channel: conversation.channel as InboxChannel,
  status: conversation.status as InboxStatus,
  participantName: conversation.participantName,
  participantAvatarUrl: conversation.participantAvatarUrl,
  externalThreadId: conversation.externalThreadId,
  unreadCount: conversation.unreadCount,
  draftBody: conversation.draftBody,
  draftSource: conversation.draftSource,
  contact: conversation.contact,
  assignedStaff: conversation.assignedStaff,
  messages: conversation.messages.map((message) => ({
    id: message.id,
    direction: message.direction,
    status: message.status,
    body: message.body,
    attachments: readAttachments(message.attachments),
    failedReason: message.failedReason,
    sentAt: message.sentAt.toISOString(),
    isEcho: message.isEcho,
    staffUser: message.staffUser,
  })),
  window: {
    isOpen: conversation.window.isOpen,
    requirement: conversation.window.requirement,
    expiresAt: conversation.window.expiresAt?.toISOString() ?? null,
  },
  windowNotice: conversation.windowNotice,
  templates: conversation.templates.map((template) => ({
    id: template.id,
    title: template.title,
    name: template.name,
    language: template.language,
    body: template.body,
  })),
});
