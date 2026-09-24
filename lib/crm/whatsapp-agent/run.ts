import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { sendMetaMessage } from "@/lib/meta/send";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getOperationalTimezone } from "../operational-timezone";
import {
  getWhatsAppAiConfig,
  isWithinOwnerHours,
  type WhatsAppAiConfig,
} from "../whatsapp-ai-config";
import {
  isWhatsAppAutoReplyEnabled,
  pauseAutoReply,
  resumeAutoReply,
} from "../whatsapp-autoreply";
import { clientContext, think, type TranscriptLine } from "./brain";
import { getMemory, refreshMemory } from "./memory";
import { approvedMessageIds, proposeForApproval, type Proposal } from "./approvals";

/**
 * El ejecutor de la IA de WhatsApp: decide si toca contestar, espera a que la
 * persona termine de escribir, contesta la ráfaga entera una vez y deja
 * rastro de cada paso en `WhatsAppAiRun`.
 *
 * Ese rastro es lo que el panel muestra en vivo («Pensando… 4 s», «Respondió
 * hace 2 min, tardó 6 s», «Te toca: pago») y lo que explica un silencio: cada
 * vez que la IA decide no contestar queda escrito por qué.
 *
 * Nunca lanza hacia fuera: corre detrás del webhook.
 */

/** Cuánto se espera a que la persona termine de escribir. */
const DEBOUNCE_MS = Number(process.env.WHATSAPP_AI_DEBOUNCE_MS ?? 8000);
/** Mensajes del hilo que lee el modelo. */
const HISTORY = 40;
/** Otra ejecución en curso en el mismo chat se espera hasta esto. */
const BUSY_WAIT_MS = 60_000;

export type RunStatus =
  | "QUEUED"
  | "THINKING"
  | "SENDING"
  | "REPLIED"
  | "DRAFTED"
  | "ESCALATED"
  | "SKIPPED"
  | "ERROR"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "CANCELLED"
  | "SUPERSEDED";

/**
 * Mensajes que no son «Dayana tomó el chat»: envíos masivos del CRM y
 * respuestas de la IA que ella aprobó. La IA no se aparta por ellos.
 */
const isSystemSource = (source: string | null | undefined) =>
  Boolean(source && (source.startsWith("bulk:") || source === "approval" || source === "autoevaluacion"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const setStatus = (
  id: string,
  status: RunStatus,
  data: Prisma.WhatsAppAiRunUpdateInput = {}
) => prisma.whatsAppAiRun.update({ where: { id }, data: { status, ...data } });

const finish = async (
  id: string,
  status: RunStatus,
  data: Prisma.WhatsAppAiRunUpdateInput = {}
) => {
  const run = await prisma.whatsAppAiRun.findUnique({
    where: { id },
    select: { queuedAt: true },
  });
  const finishedAt = new Date();
  await setStatus(id, status, {
    finishedAt,
    latencyMs: run ? finishedAt.getTime() - run.queuedAt.getTime() : null,
    ...data,
  });
};

const ownerIds = async (): Promise<string[]> =>
  (
    await prisma.staffUser.findMany({
      where: { role: "OWNER", isActive: true },
      select: { id: true },
    })
  ).map((s) => s.id);

const attachmentLabel = (attachments: unknown): string | null => {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  const KIND: Record<string, string> = {
    image: "imagen",
    audio: "audio",
    video: "video",
    document: "documento",
    sticker: "sticker",
  };
  return attachments
    .map((a) => KIND[(a as { kind?: string }).kind ?? ""] ?? "adjunto")
    .join(", ");
};

const CATEGORY_LABEL: Record<string, string> = {
  payment: "pago",
  unknown: "no sabe qué responder",
  complaint: "queja",
  clinical: "tema delicado",
  reschedule: "cambio de cita",
  other: "pendiente",
  error: "falló la IA",
};

/** ¿Hay que saludar en vez de contestar con la IA? (IA apagada o chat manual). */
const greetIfNeeded = async (conversationId: string) => {
  const { maybeSendWelcome } = await import("../whatsapp-welcome");
  await maybeSendWelcome(conversationId).catch(() => false);
};

export const runWhatsAppAi = async (input: {
  conversationId: string;
  triggerMessageId: string;
}): Promise<void> => {
  let runId: string | null = null;
  try {
    const conversationId = input.conversationId;
    const enabled = await isWhatsAppAutoReplyEnabled();
    const head = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        channel: true,
        aiMode: true,
        priorityAt: true,
        _count: { select: { messages: true } },
      },
    });
    if (!head || head.channel !== "WHATSAPP") return;

    // Un chat nuevo arranca en el modo general (IA, copiloto o manual).
    if (head._count.messages <= 1) {
      const { defaultMode } = await getWhatsAppAiConfig();
      if (defaultMode !== head.aiMode) {
        await prisma.conversation.update({ where: { id: conversationId }, data: { aiMode: defaultMode } });
        head.aiMode = defaultMode;
      }
    }

    // Favoritos (la estrella): chats importantes para Dayana. La IA no los
    // lee, no los contesta y no los saluda.
    if (enabled && head.priorityAt) {
      await prisma.whatsAppAiRun.create({
        data: {
          conversationId,
          status: "SKIPPED",
          reason: "favorite",
          triggerMessageId: input.triggerMessageId,
          finishedAt: new Date(),
          latencyMs: 0,
        },
      });
      return;
    }

    if (!enabled || head.aiMode === "MANUAL") {
      // Sin IA, el saludo de bienvenida (si está encendido) sigue funcionando.
      await greetIfNeeded(conversationId);
      await prisma.whatsAppAiRun.create({
        data: {
          conversationId,
          status: "SKIPPED",
          reason: enabled ? "manual" : "disabled",
          triggerMessageId: input.triggerMessageId,
          finishedAt: new Date(),
          latencyMs: 0,
        },
      });
      return;
    }

    const run = await prisma.whatsAppAiRun.create({
      data: {
        conversationId,
        status: "QUEUED",
        triggerMessageId: input.triggerMessageId,
      },
      select: { id: true },
    });
    runId = run.id;

    // La persona suele mandar dos o tres mensajes seguidos. Se espera un poco
    // y se contesta todo junto, como haría una persona.
    await sleep(DEBOUNCE_MS);
    // Meta da la hora al segundo: con dos mensajes en el mismo segundo, el id
    // (cuid, crece con el tiempo) desempata igual para todas las ejecuciones,
    // así que exactamente una se queda con la ráfaga.
    const latest = await prisma.conversationMessage.findFirst({
      where: { conversationId, direction: "INBOUND" },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      select: { externalMessageId: true },
    });
    if (latest?.externalMessageId && latest.externalMessageId !== input.triggerMessageId) {
      // Llegó otro mensaje después: esa ejecución contesta los dos.
      await prisma.whatsAppAiRun.delete({ where: { id: run.id } });
      runId = null;
      return;
    }

    // Otra ejecución en curso en este chat (un reintento del webhook, dos
    // avisos casi a la vez): se espera a que termine.
    const waitUntil = Date.now() + BUSY_WAIT_MS;
    while (Date.now() < waitUntil) {
      const busy = await prisma.whatsAppAiRun.count({
        where: {
          conversationId,
          id: { not: run.id },
          status: { in: ["THINKING", "SENDING"] },
          startedAt: { gte: new Date(Date.now() - 3 * 60_000) },
        },
      });
      if (busy === 0) break;
      await sleep(2000);
    }

    const config = await getWhatsAppAiConfig();
    const verdict = await gate(conversationId, config);
    if (verdict.skip) {
      if (verdict.escalate) {
        await escalate(conversationId, run.id, config, {
          category: "unknown",
          severity: "normal",
          reason: verdict.reason,
        });
      } else {
        await finish(run.id, "SKIPPED", { reason: verdict.reason });
      }
      return;
    }

    const { conversation, history } = verdict;
    await setStatus(run.id, "THINKING", { startedAt: new Date() });

    const timezone = await getOperationalTimezone();
    const phone = conversation.externalThreadId;
    const name =
      conversation.contact?.firstName?.trim() || conversation.participantName?.trim() || null;

    const result = await think({
      config,
      transcript: history,
      name,
      phone,
      conversationId,
      contactId: conversation.contactId,
      client: await clientContext(conversation.contactId),
      memory: await getMemory(phone),
      timezone,
      mode: "live",
    });

    const meta = {
      model: result.model,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
    };

    if (result.outcome.kind === "escalate") {
      await setStatus(run.id, "SENDING", meta);
      await escalate(conversationId, run.id, config, result.outcome, name, meta);
      // Un pago que la persona dice haber hecho: Dayana lo verifica y, con un
      // toque, manda la respuesta que la IA dejó preparada.
      if (result.outcome.category === "payment" && result.suggestedReply) {
        await proposeForApproval({
          runId: run.id,
          conversationId,
          name,
          proposal: {
            kind: "payment_received",
            message: result.suggestedReply,
            reason: result.outcome.reason,
          },
        });
      }
      return;
    }

    const body = result.outcome.message;
    // Mientras pensaba (unos segundos) Dayana pudo tomar el chat o escribir:
    // entonces no se envía nada; la respuesta queda como borrador para ella.
    const now = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { aiMode: true, aiPausedAt: true, priorityAt: true },
    });
    const recentSince = new Date(Date.now() - DEBOUNCE_MS - 5 * 60_000);
    const [recentHuman, recentApproved] = await Promise.all([
      prisma.conversationMessage.findMany({
        where: {
          conversationId,
          direction: "OUTBOUND",
          isAutoReply: false,
          status: { not: "FAILED" },
          // Una reacción u otro aviso desde el celular no es «Dayana contestó».
          kind: "message",
          sentAt: { gte: recentSince },
        },
        select: { id: true, source: true },
      }),
      approvedMessageIds(conversationId, recentSince),
    ]);
    const humanSince = recentHuman.filter(
      (m) => !recentApproved.has(m.id) && !isSystemSource(m.source)
    ).length;
    const tookOver =
      !now ||
      now.aiMode === "MANUAL" ||
      Boolean(now.aiPausedAt) ||
      Boolean(now.priorityAt) ||
      humanSince > 0;

    // Agendar y mandar enlaces de pago siempre esperan la autorización de
    // Dayana; en copiloto (o si ella tomó el chat mientras la IA pensaba), toda
    // respuesta espera. Solo en modo IA una respuesta simple sale sola.
    const needsApproval =
      Boolean(result.pendingBooking) ||
      Boolean(result.pendingPayment) ||
      tookOver ||
      now?.aiMode === "COPILOT" ||
      conversation.aiMode === "COPILOT";

    if (needsApproval) {
      const proposal: Proposal = {
        kind: result.pendingBooking ? "booking" : result.pendingPayment ? "payment_link" : "reply",
        message: body,
        ...(result.pendingBooking ? { booking: result.pendingBooking } : {}),
        ...(result.pendingPayment ? { payment: result.pendingPayment } : {}),
        stickerUrl: result.stickerUrl,
        ...(tookOver ? { reason: "Tomaste el chat mientras la IA pensaba." } : {}),
      };
      await proposeForApproval({ runId: run.id, conversationId, name, proposal, meta });
    } else {
      await setStatus(run.id, "SENDING", meta);
      await sendAuto(conversationId, body);
      if (result.stickerUrl) {
        await sendAutoSticker(conversationId, result.stickerUrl).catch((e) =>
          console.warn("[whatsapp-agent] sticker", e)
        );
      }
      await finish(run.id, "REPLIED");
    }

    await refreshMemory({
      phone,
      contactId: conversation.contactId,
      transcript: [...history, { direction: "OUTBOUND", body }],
    }).catch((e) => console.error("[whatsapp-agent] memoria", e));
  } catch (e) {
    console.error("[whatsapp-agent] no se pudo responder", e);
    if (runId) {
      // Ante la duda, una persona: se pausa el hilo y se avisa.
      const config = await getWhatsAppAiConfig().catch(() => null);
      await escalate(
        input.conversationId,
        runId,
        config,
        {
          category: "error",
          severity: "normal",
          reason: `La IA falló: ${e instanceof Error ? e.message.slice(0, 150) : "error"}`,
        },
        null,
        {},
        "ERROR"
      ).catch(() => undefined);
    }
  }
};

type GateResult =
  | { skip: true; reason: string; escalate?: boolean }
  | {
      skip: false;
      conversation: NonNullable<Awaited<ReturnType<typeof loadConversation>>>;
      history: TranscriptLine[];
    };

const loadConversation = (conversationId: string) =>
  prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      aiMode: true,
      aiPausedAt: true,
      aiPausedReason: true,
      priorityAt: true,
      assignedStaffId: true,
      externalThreadId: true,
      contactId: true,
      participantName: true,
      contact: {
        select: {
          firstName: true,
          enrollments: {
            where: { status: { in: ["ACTIVE", "COMPLETED"] } },
            select: { id: true },
            take: 1,
          },
        },
      },
      messages: {
        orderBy: { sentAt: "desc" },
        take: HISTORY,
        select: {
          id: true,
          direction: true,
          body: true,
          attachments: true,
          sentAt: true,
          status: true,
          isAutoReply: true,
          source: true,
        },
      },
    },
  });

/** Las reglas que no dependen del modelo. */
const gate = async (
  conversationId: string,
  config: WhatsAppAiConfig
): Promise<GateResult> => {
  if (!process.env.GEMINI_API_KEY?.trim()) return { skip: true, reason: "no_model_key" };

  if (
    config.schedule.mode === "outside_hours" &&
    isWithinOwnerHours(config.schedule, new Date(), await getOperationalTimezone())
  ) {
    return { skip: true, reason: "owner_hours" };
  }

  const conversation = await loadConversation(conversationId);
  if (!conversation) return { skip: true, reason: "not_found" };
  if (conversation.aiMode === "MANUAL") return { skip: true, reason: "manual" };
  if (conversation.priorityAt) return { skip: true, reason: "favorite" };

  if (conversation.aiPausedAt) {
    // Una escalada espera a una persona. Una pausa por respuesta humana se
    // levanta sola si Dayana lleva las horas de relevo sin escribir aquí.
    if (conversation.aiPausedReason === "escalation" || config.handoffHours === 0) {
      return { skip: true, reason: "paused" };
    }
    const lastHuman = await prisma.conversationMessage.findFirst({
      where: {
        conversationId,
        direction: "OUTBOUND",
        isAutoReply: false,
        status: { not: "FAILED" },
        kind: "message",
      },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    const since = (lastHuman?.sentAt ?? conversation.aiPausedAt).getTime();
    if (Date.now() - since < config.handoffHours * 3600_000) {
      return { skip: true, reason: "paused" };
    }
    await resumeAutoReply(conversationId);
  }
  if (conversation.assignedStaffId) return { skip: true, reason: "assigned" };

  const ordered = [...conversation.messages].reverse();
  const last = ordered.at(-1);
  if (!last || last.direction !== "INBOUND") return { skip: true, reason: "no_inbound" };

  // Dayana escribió aquí hace poco (desde el CRM o el celular): el hilo es suyo.
  // Un envío fallido no cuenta como respuesta suya.
  const viaApproval = await approvedMessageIds(
    conversationId,
    new Date(Date.now() - Math.max(config.handoffHours, 1) * 3600_000)
  );
  const lastHumanAt = ordered
    .filter(
      (m) =>
        m.direction === "OUTBOUND" &&
        !m.isAutoReply &&
        m.status !== "FAILED" &&
        !viaApproval.has(m.id) &&
        !isSystemSource(m.source)
    )
    .at(-1)?.sentAt;
  if (
    conversation.aiMode === "AUTO" &&
    lastHumanAt &&
    (config.handoffHours === 0 ||
      Date.now() - lastHumanAt.getTime() < config.handoffHours * 3600_000)
  ) {
    await pauseAutoReply(conversationId);
    return { skip: true, reason: "human_replied" };
  }

  // Libreta personal del celular (familia, amigos): si está ahí, no es alguien
  // del CRM y nunca ha tenido un chat de trabajo, no es un cliente escribiendo.
  if (config.audience.skipKnownContacts && !conversation.contactId) {
    const inAddressBook = await prisma.whatsAppKnownContact.count({
      where: { phone: conversation.externalThreadId, removedAt: null },
    });
    if (inAddressBook > 0) {
      const hadBusiness = await prisma.conversationMessage.count({
        where: { conversationId, isAutoReply: true },
      });
      if (hadBusiness === 0) return { skip: true, reason: "known_contact" };
    }
  }
  if (config.audience.skipCustomers && (conversation.contact?.enrollments.length ?? 0) > 0) {
    return { skip: true, reason: "customer" };
  }

  const autoToday = await prisma.conversationMessage.count({
    where: {
      conversationId,
      isAutoReply: true,
      sentAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  if (autoToday >= config.maxPerDay) {
    return { skip: true, escalate: true, reason: "Demasiadas respuestas automáticas hoy en este chat." };
  }

  const history: TranscriptLine[] = ordered
    .filter((m) => m.status !== "FAILED")
    .map((m) => ({
      direction: m.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      body: m.body,
      attachment: attachmentLabel(m.attachments),
      isAutoReply: m.isAutoReply,
    }));

  return { skip: false, conversation, history };
};

const escalate = async (
  conversationId: string,
  runId: string,
  config: WhatsAppAiConfig | null,
  outcome: { category: string; severity: string; reason: string },
  name?: string | null,
  meta: Prisma.WhatsAppAiRunUpdateInput = {},
  status: RunStatus = "ESCALATED"
) => {
  await pauseAutoReply(conversationId, "escalation", outcome);
  const holding = config?.escalation.holdingMessage.trim();
  if (holding && status === "ESCALATED") {
    await sendAuto(conversationId, holding).catch((e) =>
      console.error("[whatsapp-agent] mensaje de espera", e)
    );
  }
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "OPEN" },
  });
  await finish(runId, status, {
    ...meta,
    reason: outcome.reason.slice(0, 300),
    category: outcome.category,
    severity: outcome.severity,
  });

  const who =
    name ??
    (
      await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { participantName: true, externalThreadId: true },
      })
    )?.participantName ??
    null;
  const urgent = outcome.severity === "urgent";
  fireNotification({
    eventType: "WHATSAPP_AI_ESCALATED",
    severity: urgent ? "ERROR" : "WARNING",
    title: `${urgent ? "URGENTE — " : ""}WhatsApp: te toca${who ? ` con ${who}` : ""} (${CATEGORY_LABEL[outcome.category] ?? outcome.category})`,
    body: outcome.reason.slice(0, 200),
    href: `/admin/whatsapp?conversation=${conversationId}`,
    entityType: "Conversation",
    entityId: conversationId,
    staff: config?.notify === "OWNERS" ? await ownerIds() : "ALL",
  });
};

// `isAutoReply` va en la misma fila que se crea: si se marcaba después, el
// filtro de «Dayana tomó el chat» podía ver un instante la respuesta de la IA
// como humana y pausar el chat.
const sendAutoSticker = async (conversationId: string, url: string) => {
  await sendMetaMessage({
    conversationId,
    body: "",
    attachment: { url, mimeType: "image/webp", filename: "sticker.webp", kind: "sticker" },
    isAutoReply: true,
  });
};

const sendAuto = async (conversationId: string, body: string) => {
  await sendMetaMessage({ conversationId, body, isAutoReply: true });
};
