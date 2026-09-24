import { Prisma, type WhatsAppAiMode } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { getWhatsAppProviderSummary } from "@/lib/meta/whatsapp-provider";
import { isPushConfigured } from "@/lib/notifications/channels/push";
import { windowStateOf } from "../whatsapp-outbound-plan";
import { phoneUrlFor, resolveApprovalDelivery, type Proposal } from "./approvals";

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
  /**
   * Lo que dijo WhatsApp del mensaje que salió en esta vuelta (enviado,
   * entregado, leído o fallido). La línea de estado y la burbuja del mensaje
   * salen de aquí las dos, para que nunca digan cosas distintas.
   */
  delivery?: { status: string; error: string | null } | null;
};

type DeliveryMessage = {
  id: string;
  direction: string;
  status: string | null;
  failedReason?: string | null;
  isAutoReply: boolean;
  sentAt: Date;
};

/**
 * El mensaje que salió en una vuelta de la IA: el aprobado (su id queda en la
 * propuesta) o el que la IA mandó sola mientras corría.
 */
export const deliveryOf = (
  run: { status: string; startedAt: Date | null; finishedAt: Date | null; proposal?: unknown },
  messages: DeliveryMessage[]
): RunView["delivery"] => {
  const pick = (m: DeliveryMessage | undefined) =>
    m ? { status: m.status ?? "SENT", error: m.status === "FAILED" ? (m.failedReason ?? null) : null } : null;
  if (run.status === "APPROVED") {
    const id = (run.proposal as { sentMessageId?: string } | null)?.sentMessageId;
    return id ? pick(messages.find((m) => m.id === id)) : null;
  }
  if (run.status === "REPLIED" && run.startedAt) {
    const from = run.startedAt.getTime();
    const to = (run.finishedAt ?? run.startedAt).getTime() + 15_000;
    const sent = messages.filter(
      (m) => m.direction === "OUTBOUND" && m.isAutoReply && m.sentAt.getTime() >= from && m.sentAt.getTime() <= to
    );
    return pick(sent.find((m) => m.status === "FAILED") ?? sent[sent.length - 1]);
  }
  return null;
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
  /** Lo que dijo WhatsApp del último mensaje (el mismo estado que en el chat). */
  lastStatus: string | null;
  lastFailedReason: string | null;
  unreadCount: number;
  aiMode: WhatsAppAiMode;
  paused: boolean;
  pausedReason: string | null;
  escalation: { category: string | null; severity: string | null; reason: string | null } | null;
  priority: boolean;
  hasDraft: boolean;
  /** Hay algo esperando la autorización de Dayana (borrador, cita, pago). */
  awaitingApproval: string | null;
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

const PREVIEW_KIND: Record<string, string> = {
  image: "📷 Foto",
  sticker: "Sticker",
  audio: "🎤 Audio",
  video: "🎥 Video",
  document: "📄 Documento",
};

const queueWhere = (queue: ChatQueue): Prisma.ConversationWhereInput => {
  switch (queue) {
    case "attention":
      return {
        OR: [
          { aiPausedReason: "escalation" },
          { aiRuns: { some: { status: "AWAITING_APPROVAL" } } },
        ],
      };
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
        take: 3,
        select: {
          id: true,
          body: true,
          direction: true,
          isAutoReply: true,
          attachments: true,
          status: true,
          failedReason: true,
          sentAt: true,
        },
      },
      aiRuns: { orderBy: { queuedAt: "desc" }, take: 1, select: { ...RUN_SELECT, proposal: true } },
    },
  });

  const pending = await prisma.whatsAppAiRun.findMany({
    where: { conversationId: { in: rows.map((r) => r.id) }, status: "AWAITING_APPROVAL" },
    select: { conversationId: true, proposal: true },
  });
  const pendingBy = new Map(
    pending.map((p) => [p.conversationId, (p.proposal as { kind?: string } | null)?.kind ?? "reply"])
  );

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
      lastMessage: !last
        ? pendingBy.has(c.id)
          ? "Mensaje por aprobar"
          : "Aún no hay mensajes"
        : last.body ||
        (Array.isArray(last?.attachments) && last.attachments.length > 0
          ? PREVIEW_KIND[String((last.attachments[0] as { kind?: string }).kind)] ?? "📎 Archivo"
          : null),
      lastDirection: last?.direction ?? null,
      lastIsAutoReply: last?.isAutoReply ?? false,
      lastStatus: last?.status ?? null,
      lastFailedReason: last?.status === "FAILED" ? (last.failedReason ?? null) : null,
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
      awaitingApproval: pendingBy.get(c.id) ?? null,
      lastRun: c.aiRuns[0] ? { ...runView(c.aiRuns[0]), delivery: deliveryOf(c.aiRuns[0], c.messages) } : null,
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
  /** Por qué WhatsApp no lo entregó (solo si falló). */
  failedReason: string | null;
  /** Quién lo originó («resend:<id>» = reenvío de un mensaje que falló). */
  source: string | null;
  /** message | system (aviso gris: reacción, encuesta, tipo no compatible…). */
  kind: string;
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
          failedReason: true,
          source: true,
          kind: true,
          staffUser: { select: { displayName: true } },
        },
      },
      aiRuns: { orderBy: { queuedAt: "desc" }, take: 20, select: { ...RUN_SELECT, toolCalls: true, proposal: true } },
      aiBookings: {
        orderBy: { startsAt: "desc" },
        take: 10,
        select: { id: true, service: true, startsAt: true, meetUrl: true, eventUrl: true, status: true },
      },
    },
  });
  if (!c || c.channel !== "WHATSAPP") return null;

  const approvals = await prisma.whatsAppAiRun.findMany({
    where: { conversationId: id, status: "AWAITING_APPROVAL" },
    orderBy: { queuedAt: "desc" },
    select: { id: true, proposal: true, queuedAt: true },
  });
  const approvalViews = await Promise.all(
    approvals.map(async (a) => {
      const proposal = a.proposal as unknown as Proposal;
      return {
        runId: a.id,
        createdAt: a.queuedAt.toISOString(),
        proposal,
        delivery: await resolveApprovalDelivery({ lastInboundAt: c.lastInboundAt }, proposal),
        phoneUrl: phoneUrlFor(c.externalThreadId, proposal.message),
      };
    })
  );

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
    windowState: windowStateOf(c.lastInboundAt),
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
        failedReason: m.status === "FAILED" ? (m.failedReason ?? null) : null,
        source: m.source ?? null,
        kind: m.kind,
      })
    ),
    runs: c.aiRuns.map((r) => ({ ...runView(r), toolCalls: r.toolCalls, delivery: deliveryOf(r, c.messages) })),
    bookings: c.aiBookings.map((b) => ({
      id: b.id,
      service: b.service,
      startsAt: b.startsAt.toISOString(),
      meetUrl: b.meetUrl,
      eventUrl: b.eventUrl,
      status: b.status,
    })),
    memory: memory ? { notes: memory.notes, updatedAt: memory.updatedAt.toISOString() } : null,
    approvals: approvalViews,
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

export type StickerView = {
  key: string;
  url: string;
  uses: number;
  lastUsedAt: string;
  /** Lo que Dayana escribió justo antes de mandarlo: dice para qué lo usa. */
  contexts: string[];
};

/**
 * Los stickers que usa Dayana: los que ha mandado (desde el celular o el CRM),
 * sin repetir y los más usados primero. El mismo sticker enviado varias veces
 * se reconoce por su huella (sha256).
 */
export const listDayanaStickers = async (limit = 60): Promise<StickerView[]> => {
  const rows = await prisma.$queryRaw<
    { attachments: unknown; sent_at: Date; before: string | null }[]
  >(Prisma.sql`
    SELECT m.attachments, m.sent_at,
      (SELECT p.body FROM conversation_messages p
        WHERE p.conversation_id = m.conversation_id
          AND p.direction = 'OUTBOUND' AND p.body IS NOT NULL AND p.body <> ''
          AND p.sent_at <= m.sent_at AND p.sent_at > m.sent_at - interval '3 minutes'
        ORDER BY p.sent_at DESC LIMIT 1) AS before
    FROM conversation_messages m
    WHERE m.direction = 'OUTBOUND'
      AND m.attachments @> '[{"kind":"sticker"}]'::jsonb
    ORDER BY m.sent_at DESC
    LIMIT 3000`);
  const byKey = new Map<string, StickerView>();
  for (const row of rows) {
    for (const a of (Array.isArray(row.attachments) ? row.attachments : []) as {
      kind?: string;
      url?: string | null;
      sha256?: string;
    }[]) {
      if (a.kind !== "sticker" || !a.url) continue;
      const key = a.sha256 ?? a.url;
      const current =
        byKey.get(key) ??
        { key, url: a.url, uses: 0, lastUsedAt: row.sent_at.toISOString(), contexts: [] };
      current.uses++;
      if (row.before && current.contexts.length < 3) current.contexts.push(row.before.slice(0, 120));
      byKey.set(key, current);
    }
  }
  return [...byKey.values()].sort((a, b) => b.uses - a.uses).slice(0, limit);
};
