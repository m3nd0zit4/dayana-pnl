import { Prisma, type WhatsAppAiMode } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { getWhatsAppProviderSummary } from "@/lib/meta/whatsapp-provider";
import { isPushConfigured } from "@/lib/notifications/channels/push";

/**
 * Lo que lee la sección de WhatsApp del CRM: chats con su estado de IA en
 * vivo, el detalle de un chat, y el tablero de estado.
 *
 * Vive aparte de la bandeja general (`/admin/inbox`) porque aquí todo gira
 * alrededor de la IA: quién atiende cada chat, qué está haciendo el asistente
 * ahora mismo y qué le toca a Dayana.
 */

export type RunView = {
  id: string;
  status: string;
  reason: string | null;
  category: string | null;
  severity: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
};

export type ChatQueue = "attention" | "mine" | "ai" | "all";

export type ChatListItem = {
  id: string;
  phone: string;
  name: string;
  contactId: string | null;
  lastMessageAt: string;
  lastMessage: string | null;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  lastIsAutoReply: boolean;
  unreadCount: number;
  aiMode: WhatsAppAiMode;
  paused: boolean;
  pausedReason: string | null;
  escalation: { category: string | null; severity: string | null; reason: string | null } | null;
  priority: boolean;
  hasDraft: boolean;
  lastRun: RunView | null;
};

const runView = (r: {
  id: string;
  status: string;
  reason: string | null;
  category: string | null;
  severity: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  latencyMs: number | null;
}): RunView => ({
  id: r.id,
  status: r.status,
  reason: r.reason,
  category: r.category,
  severity: r.severity,
  queuedAt: r.queuedAt.toISOString(),
  startedAt: r.startedAt?.toISOString() ?? null,
  finishedAt: r.finishedAt?.toISOString() ?? null,
  latencyMs: r.latencyMs,
});

const RUN_SELECT = {
  id: true,
  status: true,
  reason: true,
  category: true,
  severity: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  latencyMs: true,
} as const;

const queueWhere = (queue: ChatQueue): Prisma.ConversationWhereInput => {
  switch (queue) {
    case "attention":
      return { aiPausedReason: "escalation" };
    case "mine":
      return { OR: [{ aiMode: "MANUAL" }, { priorityAt: { not: null } }] };
    case "ai":
      return { aiMode: { in: ["AUTO", "COPILOT"] }, aiPausedAt: null, priorityAt: null };
    default:
      return {};
  }
};

export const listChats = async (input: {
  queue: ChatQueue;
  q?: string;
  take?: number;
}): Promise<ChatListItem[]> => {
  const q = input.q?.trim();
  const rows = await prisma.conversation.findMany({
    where: {
      channel: "WHATSAPP",
      ...queueWhere(input.queue),
      ...(q
        ? {
            OR: [
              { participantName: { contains: q, mode: "insensitive" } },
              { externalThreadId: { contains: q.replace(/\D/g, "") || q } },
              { contact: { firstName: { contains: q, mode: "insensitive" } } },
              { contact: { lastName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy:
      input.queue === "mine"
        ? [{ priorityAt: { sort: "desc", nulls: "last" } }, { lastMessageAt: "desc" }]
        : [{ lastMessageAt: "desc" }],
    take: input.take ?? 60,
    select: {
      id: true,
      externalThreadId: true,
      participantName: true,
      contactId: true,
      lastMessageAt: true,
      unreadCount: true,
      aiMode: true,
      aiPausedAt: true,
      aiPausedReason: true,
      escalationCategory: true,
      escalationSeverity: true,
      escalationReason: true,
      priorityAt: true,
      draftBody: true,
      contact: { select: { firstName: true, lastName: true } },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { body: true, direction: true, isAutoReply: true, attachments: true },
      },
      aiRuns: { orderBy: { queuedAt: "desc" }, take: 1, select: RUN_SELECT },
    },
  });

  const items = rows.map((c): ChatListItem => {
    const last = c.messages[0];
    const name =
      [c.contact?.firstName, c.contact?.lastName].filter(Boolean).join(" ") ||
      c.participantName ||
      `+${c.externalThreadId}`;
    return {
      id: c.id,
      phone: c.externalThreadId,
      name,
      contactId: c.contactId,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessage: last?.body ?? (last?.attachments ? "(adjunto)" : null),
      lastDirection: last?.direction ?? null,
      lastIsAutoReply: last?.isAutoReply ?? false,
      unreadCount: c.unreadCount,
      aiMode: c.aiMode,
      paused: Boolean(c.aiPausedAt),
      pausedReason: c.aiPausedReason,
      escalation:
        c.aiPausedReason === "escalation"
          ? {
              category: c.escalationCategory,
              severity: c.escalationSeverity,
              reason: c.escalationReason,
            }
          : null,
      priority: Boolean(c.priorityAt),
      hasDraft: Boolean(c.draftBody),
      lastRun: c.aiRuns[0] ? runView(c.aiRuns[0]) : null,
    };
  });

  // En «Te toca», lo urgente arriba.
  if (input.queue === "attention") {
    items.sort(
      (a, b) =>
        Number(b.escalation?.severity === "urgent") -
          Number(a.escalation?.severity === "urgent") ||
        b.lastMessageAt.localeCompare(a.lastMessageAt)
    );
  }
  return items;
};

export const queueCounts = async () => {
  const base = { channel: "WHATSAPP" as const };
  const [attention, mine, ai, unread] = await Promise.all([
    prisma.conversation.count({ where: { ...base, ...queueWhere("attention") } }),
    prisma.conversation.count({ where: { ...base, ...queueWhere("mine") } }),
    prisma.conversation.count({ where: { ...base, ...queueWhere("ai") } }),
    prisma.conversation.aggregate({
      where: { ...base, unreadCount: { gt: 0 } },
      _sum: { unreadCount: true },
    }),
  ]);
  return { attention, mine, ai, unread: unread._sum.unreadCount ?? 0 };
};

export type ChatMessageView = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  attachments: { kind: string; url: string | null; mimeType: string | null; caption: string | null }[];
  sentAt: string;
  status: string;
  isAutoReply: boolean;
  isEcho: boolean;
  staffName: string | null;
};

export const getChat = async (id: string) => {
  const c = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      channel: true,
      externalThreadId: true,
      participantName: true,
      contactId: true,
      lastInboundAt: true,
      aiMode: true,
      aiPausedAt: true,
      aiPausedReason: true,
      escalationCategory: true,
      escalationSeverity: true,
      escalationReason: true,
      priorityAt: true,
      draftBody: true,
      draftSource: true,
      contact: { select: { firstName: true, lastName: true, email: true } },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 120,
        select: {
          id: true,
          direction: true,
          body: true,
          attachments: true,
          sentAt: true,
          status: true,
          isAutoReply: true,
          isEcho: true,
          staffUser: { select: { displayName: true } },
        },
      },
      aiRuns: { orderBy: { queuedAt: "desc" }, take: 20, select: { ...RUN_SELECT, toolCalls: true } },
      aiBookings: {
        orderBy: { startsAt: "desc" },
        take: 10,
        select: { id: true, service: true, startsAt: true, meetUrl: true, status: true },
      },
    },
  });
  if (!c || c.channel !== "WHATSAPP") return null;

  const memory = await prisma.whatsAppMemory.findUnique({
    where: { phone: c.externalThreadId },
    select: { notes: true, updatedAt: true },
  });

  const name =
    [c.contact?.firstName, c.contact?.lastName].filter(Boolean).join(" ") ||
    c.participantName ||
    `+${c.externalThreadId}`;

  return {
    id: c.id,
    phone: c.externalThreadId,
    name,
    contactId: c.contactId,
    email: c.contact?.email ?? null,
    windowOpen: c.lastInboundAt
      ? Date.now() - c.lastInboundAt.getTime() < 24 * 3600_000
      : false,
    aiMode: c.aiMode,
    paused: Boolean(c.aiPausedAt),
    pausedReason: c.aiPausedReason,
    escalation:
      c.aiPausedReason === "escalation"
        ? { category: c.escalationCategory, severity: c.escalationSeverity, reason: c.escalationReason }
        : null,
    priority: Boolean(c.priorityAt),
    draft: c.draftBody ? { body: c.draftBody, source: c.draftSource } : null,
    messages: [...c.messages].reverse().map(
      (m): ChatMessageView => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        attachments: Array.isArray(m.attachments)
          ? (m.attachments as ChatMessageView["attachments"])
          : [],
        sentAt: m.sentAt.toISOString(),
        status: m.status,
        isAutoReply: m.isAutoReply,
        isEcho: m.isEcho,
        staffName: m.staffUser?.displayName ?? null,
      })
    ),
    runs: c.aiRuns.map((r) => ({ ...runView(r), toolCalls: r.toolCalls })),
    bookings: c.aiBookings.map((b) => ({
      id: b.id,
      service: b.service,
      startsAt: b.startsAt.toISOString(),
      meetUrl: b.meetUrl,
      status: b.status,
    })),
    memory: memory ? { notes: memory.notes, updatedAt: memory.updatedAt.toISOString() } : null,
  };
};

export type ChatDetail = NonNullable<Awaited<ReturnType<typeof getChat>>>;

/** Para el stream: cambia cuando entra un mensaje o la IA avanza un paso. */
export const workspaceSnapshot = async (): Promise<{ unread: number; latestAt: number }> => {
  const [row] = await prisma.$queryRaw<{ unread: bigint | null; latest: Date | null }[]>(Prisma.sql`
    SELECT
      (SELECT COALESCE(SUM(unread_count), 0) FROM conversations WHERE channel = 'WHATSAPP') AS unread,
      GREATEST(
        (SELECT MAX(last_message_at) FROM conversations WHERE channel = 'WHATSAPP'),
        (SELECT MAX(GREATEST(queued_at, COALESCE(started_at, queued_at), COALESCE(finished_at, queued_at)))
           FROM whatsapp_ai_runs WHERE queued_at > now() - interval '1 day'),
        (SELECT MAX(updated_at) FROM conversations WHERE channel = 'WHATSAPP')
      ) AS latest`);
  return { unread: Number(row?.unread ?? 0), latestAt: row?.latest?.getTime() ?? 0 };
};

/** El tablero de «Estado»: qué hizo la IA hoy y si todo está conectado. */
export const getOverview = async () => {
  const startOfDay = new Date(Date.now() - 24 * 3600_000);
  const [enabled, config, provider, runs, byStatus, lastInbound, googleCalendar, pushDevices, avg] =
    await Promise.all([
      isWhatsAppAutoReplyEnabled(),
      getWhatsAppAiConfig(),
      getWhatsAppProviderSummary(),
      prisma.whatsAppAiRun.findMany({
        orderBy: { queuedAt: "desc" },
        take: 60,
        select: {
          ...RUN_SELECT,
          conversation: {
            select: { id: true, participantName: true, externalThreadId: true },
          },
        },
      }),
      prisma.whatsAppAiRun.groupBy({
        by: ["status"],
        where: { queuedAt: { gte: startOfDay } },
        _count: { _all: true },
      }),
      prisma.conversationMessage.findFirst({
        where: { direction: "INBOUND", conversation: { channel: "WHATSAPP" } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      prisma.googleAccount.count({ where: { isActive: true, services: { has: "CALENDAR" } } }),
      prisma.pushSubscription.count(),
      prisma.whatsAppAiRun.aggregate({
        where: { queuedAt: { gte: startOfDay }, status: { in: ["REPLIED", "DRAFTED"] } },
        _avg: { latencyMs: true },
      }),
    ]);

  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const bookingsToday = await prisma.whatsAppBooking.count({
    where: { createdAt: { gte: startOfDay } },
  });

  return {
    enabled,
    kpis: {
      replied: count("REPLIED"),
      drafted: count("DRAFTED"),
      escalated: count("ESCALATED"),
      errors: count("ERROR"),
      skipped: count("SKIPPED"),
      bookings: bookingsToday,
      avgLatencyMs: avg._avg.latencyMs ? Math.round(avg._avg.latencyMs) : null,
    },
    health: {
      provider: provider.provider,
      providerConnected:
        provider.provider === "dialog360" ? provider.hasApiKey : provider.metaEnvConfigured,
      webhookRegistered:
        provider.provider === "dialog360" ? provider.webhookRegistered : provider.metaEnvConfigured,
      lastInboundAt: lastInbound?.sentAt.toISOString() ?? null,
      modelKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
      calendarAccounts: googleCalendar,
      bookingEnabled: config.booking.enabled,
      pushConfigured: isPushConfigured(),
      pushDevices,
    },
    runs: runs.map((r) => ({
      ...runView(r),
      conversationId: r.conversation.id,
      name: r.conversation.participantName || `+${r.conversation.externalThreadId}`,
    })),
  };
};

/**
 * ¿Se muestra la sección de WhatsApp? Con la bandeja general encendida, o con
 * WhatsApp conectado (360dialog con clave, o Meta con credenciales): la
 * sección no puede depender de un interruptor de entorno que nadie recuerda.
 */
export const isWhatsAppWorkspaceAvailable = async (): Promise<boolean> => {
  if (process.env.META_INBOX_ENABLED === "true") return true;
  const p = await getWhatsAppProviderSummary().catch(() => null);
  if (!p) return false;
  return p.provider === "dialog360" ? p.hasApiKey : p.metaEnvConfigured;
};
