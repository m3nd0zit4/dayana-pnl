import type {
  ConversationChannel,
  ConversationStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { writeAuditLog } from "./audit";
import { sendMetaMessage } from "../meta/send";
import { resolveWindow, explainWindow, type WindowState } from "../meta/window";

/**
 * Acceso a datos de la bandeja de entrada.
 *
 * Igual que el resto de `lib/crm/`, las rutas de API nunca tocan Prisma
 * directamente: todo pasa por aquí.
 */

export const INBOX_PAGE_SIZE = 30;

export type ConversationFilters = {
  channel?: ConversationChannel;
  status?: ConversationStatus;
  assignedStaffId?: string;
  /** Solo hilos sin contacto vinculado — el trabajo pendiente de Instagram. */
  unlinkedOnly?: boolean;
  search?: string;
  cursor?: string;
};

const listSelect = {
  id: true,
  channel: true,
  status: true,
  participantName: true,
  participantHandle: true,
  participantAvatarUrl: true,
  externalThreadId: true,
  lastMessageAt: true,
  lastInboundAt: true,
  unreadCount: true,
  assignedStaffId: true,
  contact: {
    select: { id: true, firstName: true, lastName: true, displayName: true },
  },
  assignedStaff: { select: { id: true, displayName: true } },
  messages: {
    orderBy: { sentAt: "desc" },
    take: 1,
    select: { body: true, direction: true, sentAt: true },
  },
} satisfies Prisma.ConversationSelect;

export const listConversations = async (filters: ConversationFilters = {}) => {
  const where: Prisma.ConversationWhereInput = {
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assignedStaffId
      ? { assignedStaffId: filters.assignedStaffId }
      : {}),
    ...(filters.unlinkedOnly ? { contactId: null } : {}),
    ...(filters.search
      ? {
          OR: [
            { participantName: { contains: filters.search, mode: "insensitive" } },
            { participantHandle: { contains: filters.search, mode: "insensitive" } },
            { externalThreadId: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const rows = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: INBOX_PAGE_SIZE + 1,
    ...(filters.cursor
      ? { cursor: { id: filters.cursor }, skip: 1 }
      : {}),
    select: listSelect,
  });

  const hasMore = rows.length > INBOX_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, INBOX_PAGE_SIZE) : rows;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
};

export type ConversationDetail = NonNullable<
  Awaited<ReturnType<typeof getConversation>>
>;

export const getConversation = async (
  id: string,
  messageLimit = 100
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          phoneE164: true,
          email: true,
        },
      },
      assignedStaff: { select: { id: true, displayName: true } },
      messages: {
        orderBy: { sentAt: "desc" },
        take: messageLimit,
        include: {
          staffUser: { select: { id: true, displayName: true } },
        },
      },
    },
  });
  if (!conversation) return null;

  const window = resolveWindow(conversation.channel, conversation.lastInboundAt);

  return {
    ...conversation,
    // Se devuelven en orden cronológico; la consulta va al revés solo para
    // quedarse con los últimos N.
    messages: [...conversation.messages].reverse(),
    window,
    windowNotice: explainWindow(window),
  };
};

/** Estado agregado para el stream SSE. Debe ser una sola consulta barata. */
export const inboxSnapshot = async (): Promise<{
  unread: number;
  latestAt: number;
}> => {
  const [aggregate, latest] = await Promise.all([
    prisma.conversation.aggregate({
      _sum: { unreadCount: true },
      where: { unreadCount: { gt: 0 } },
    }),
    prisma.conversation.findFirst({
      orderBy: { lastMessageAt: "desc" },
      select: { lastMessageAt: true },
    }),
  ]);

  return {
    unread: aggregate._sum.unreadCount ?? 0,
    latestAt: latest?.lastMessageAt.getTime() ?? 0,
  };
};

export const markConversationRead = async (id: string) =>
  prisma.conversation.update({
    where: { id },
    data: { unreadCount: 0 },
    select: { id: true },
  });

export const setConversationStatus = async (
  id: string,
  status: ConversationStatus,
  staffUserId: string
) => {
  const updated = await prisma.conversation.update({
    where: { id },
    data: { status },
    select: { id: true, status: true },
  });
  await writeAuditLog({
    staffUserId,
    action: "CONVERSATION_STATUS_CHANGED",
    entityType: "Conversation",
    entityId: id,
    changes: { status },
  });
  return updated;
};

export const assignConversation = async (
  id: string,
  assignedStaffId: string | null,
  actingStaffId: string
) => {
  const updated = await prisma.conversation.update({
    where: { id },
    data: { assignedStaffId },
    select: { id: true, assignedStaffId: true },
  });
  await writeAuditLog({
    staffUserId: actingStaffId,
    action: "CONVERSATION_ASSIGNED",
    entityType: "Conversation",
    entityId: id,
    changes: { assignedStaffId },
  });
  return updated;
};

/**
 * Vincula un hilo a un contacto y recuerda la identidad del canal.
 *
 * Lo segundo es lo que hace que la vinculación valga para siempre: la próxima
 * vez que esa persona escriba por Instagram, el hilo nace ya vinculado.
 */
export const linkConversationToContact = async (
  conversationId: string,
  contactId: string,
  staffUserId: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, channel: true, externalThreadId: true, participantName: true },
  });
  if (!conversation) throw new Error("La conversación no existe.");

  const [updated] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: { contactId },
      select: { id: true, contactId: true },
    }),
    prisma.contactChannelIdentity.upsert({
      where: {
        channel_externalId: {
          channel: conversation.channel,
          externalId: conversation.externalThreadId,
        },
      },
      create: {
        contactId,
        channel: conversation.channel,
        externalId: conversation.externalThreadId,
        displayName: conversation.participantName,
        linkedByStaffId: staffUserId,
      },
      update: { contactId, linkedByStaffId: staffUserId },
    }),
  ]);

  await writeAuditLog({
    staffUserId,
    action: "CONVERSATION_LINKED",
    entityType: "Conversation",
    entityId: conversationId,
    changes: {
      contactId,
      channel: conversation.channel,
      externalId: conversation.externalThreadId,
    },
  });

  return updated;
};

export const saveConversationDraft = async (
  conversationId: string,
  body: string | null,
  source: "AGENT" | "STAFF"
) =>
  prisma.conversation.update({
    where: { id: conversationId },
    data: {
      draftBody: body,
      draftSource: body ? source : null,
      draftUpdatedAt: body ? new Date() : null,
    },
    select: { id: true, draftBody: true, draftSource: true, draftUpdatedAt: true },
  });

export type ReplyInput = {
  conversationId: string;
  body: string;
  staffUserId: string;
  template?: {
    name: string;
    language: string;
    variables?: string[];
  } | null;
};

/** Responde en un hilo. Deja rastro en el audit log como toda escritura del CRM. */
export const replyToConversation = async (input: ReplyInput) => {
  const result = await sendMetaMessage({
    conversationId: input.conversationId,
    body: input.body,
    staffUserId: input.staffUserId,
    template: input.template,
  });

  await writeAuditLog({
    staffUserId: input.staffUserId,
    action: "CONVERSATION_REPLIED",
    entityType: "Conversation",
    entityId: input.conversationId,
    changes: {
      chars: input.body.length,
      template: input.template?.name ?? null,
      dryRun: result.dryRun,
    },
  });

  return result;
};

export type { WindowState };
