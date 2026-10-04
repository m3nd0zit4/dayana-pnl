import { mentionsPrice } from "./price-guard";
import { polishReply } from "./wording";
import { effectiveAiMode } from "./mode";
import { Prisma } from "@prisma/client";

import { loadImages, pickImages } from "./vision";
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
import {
  burstState,
  lastInboundSeen,
  opensAttention,
  repliedSince,
  type AttentionReason,
} from "../whatsapp-attention-rules";
import { clientContext, think, type TranscriptLine } from "./brain";
import { getMemory, refreshMemory } from "./memory";
import { approvedMessageIds, proposeForApproval, supersedePending, type Proposal } from "./approvals";
import { closeAttention, openAttention, openAttentionIfNeedsReply, recentOffer } from "./attention";
import { categoryGate, type CategoryGate } from "./category-gate";

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
/**
 * Lo que lee el modelo del hilo: todo lo de las últimas 2 semanas (hasta
 * HISTORY mensajes) y, si el chat estuvo quieto, al menos los últimos
 * HISTORY_MIN, para no perder el hilo.
 */
const HISTORY = 400;
const HISTORY_MIN = 40;
const HISTORY_DAYS = 14;
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
  other: "revisar",
  error: "falló la IA",
  booking: "quiere agendar",
};

/**
 * ¿Hay que saludar en vez de contestar con la IA? (IA apagada o chat manual).
 * Nunca a un chat callado por su categoría (aquí sin preguntar a la IA).
 */
const greetIfNeeded = async (conversationId: string, silenced: CategoryGate) => {
  if (await silenced({ allowAi: false })) return;
  const { maybeSendWelcome } = await import("../whatsapp-welcome");
  await maybeSendWelcome(conversationId).catch(() => false);
};

/**
 * ¿Dayana contestó (CRM, propuesta aprobada o celular) después de `since`, el
 * último mensaje de la persona que esta vuelta atiende? Entonces la IA no hace
 * nada: ni escala, ni pide la cita, ni manda la espera, ni avisa, ni deja borrador.
 */
const answeredSince = async (conversationId: string, since: Date | null | undefined): Promise<boolean> => {
  if (!since) return false;
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lastHumanReplyAt: true },
  });
  return repliedSince(c?.lastHumanReplyAt, since);
};

/**
 * La IA no contesta aquí: si lo que escribió importa, le toca a Dayana. Un
 * chat callado por su categoría (personal, negocio/app, equipo) no le toca.
 * No pregunta a la IA: usa lo que ya decidió la puerta en esta vuelta, si llegó.
 */
const handOffIfNeeded = async (conversationId: string, skipReason: string, silenced: CategoryGate) => {
  if (!opensAttention(skipReason)) return;
  if (await silenced({ allowAi: false })) return;
  await openAttentionIfNeedsReply(conversationId).catch((e: unknown) =>
    console.warn("[whatsapp-agent] no se pudo abrir «Te toca»", e)
  );
};

const ATTENTION_REASONS = new Set<string>([
  "payment",
  "unknown",
  "complaint",
  "clinical",
  "reschedule",
  "booking",
  "other",
  "error",
]);
const attentionReasonOf = (category: string): AttentionReason =>
  (ATTENTION_REASONS.has(category) ? category : "other") as AttentionReason;

export const runWhatsAppAi = async (input: {
  conversationId: string;
  triggerMessageId: string;
}): Promise<void> => {
  let runId: string | null = null;
  try {
    const conversationId = input.conversationId;
    // La categoría se mira como mucho una vez por vuelta (reglas y, si hace falta, la IA).
    const silenced = categoryGate(conversationId);
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

    // El modo general (Ajustes) manda: ningún chat es más suelto que él, sea
    // nuevo, creado por un envío masivo o viejo. Se deja guardado para que el
    // chat muestre el modo con el que de verdad trabaja.
    {
      const { defaultMode } = await getWhatsAppAiConfig();
      const mode = effectiveAiMode(head.aiMode, defaultMode);
      if (mode !== head.aiMode) {
        await prisma.conversation.update({ where: { id: conversationId }, data: { aiMode: mode } });
        head.aiMode = mode;
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
      await handOffIfNeeded(conversationId, "favorite", silenced);
      return;
    }

    if (!enabled || head.aiMode === "MANUAL") {
      // Sin IA, el saludo de bienvenida (si está encendido) sigue funcionando.
      await greetIfNeeded(conversationId, silenced);
      const reason = enabled ? "manual" : "disabled";
      await prisma.whatsAppAiRun.create({
        data: {
          conversationId,
          status: "SKIPPED",
          reason,
          triggerMessageId: input.triggerMessageId,
          finishedAt: new Date(),
          latencyMs: 0,
        },
      });
      await handOffIfNeeded(conversationId, reason, silenced);
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
      select: { externalMessageId: true, sentAt: true },
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

    // Lo último que escribió la persona es lo que esta vuelta contesta. Si
    // Dayana contestó después mientras la IA esperaba (desde el CRM o el
    // celular), ya está atendido: la IA no hace nada.
    const since = latest?.sentAt ?? null;
    if (await answeredSince(conversationId, since)) {
      await finish(run.id, "SKIPPED", { reason: "replied_meanwhile" });
      return;
    }

    const config = await getWhatsAppAiConfig();
    const verdict = await gate(conversationId, config, silenced);
    if (verdict.skip) {
      if (verdict.escalate) {
        await escalate(
          conversationId,
          run.id,
          config,
          { category: "unknown", severity: "normal", reason: verdict.reason },
          null,
          {},
          "ESCALATED",
          since
        );
      } else {
        await finish(run.id, "SKIPPED", { reason: verdict.reason });
        await handOffIfNeeded(conversationId, verdict.reason, silenced);
      }
      return;
    }

    const { conversation, history } = verdict;

    // ¿Lo que escribió pide respuesta? Un «gracias» nunca; un «ok», un 👍 o un
    // sticker solo si le habíamos preguntado algo (una pregunta, un enlace, una
    // invitación, un recordatorio, horas o una cita ofrecidas hace poco): ahí
    // es un «sí».
    const burst = burstState(conversation.messages, {
      recentOffer: await recentOffer(conversationId),
      coveredUntil: conversation.lastHumanReplyAt,
    });
    // En copiloto, a lo que no pide respuesta no se le propone nada: ni se
    // llama al modelo. (En modo IA sí puede salir un «Con gusto».)
    if (effectiveAiMode(conversation.aiMode, config.defaultMode) === "COPILOT" && !burst.needsReply) {
      await finish(run.id, "SKIPPED", { reason: "trivial" });
      return;
    }

    await setStatus(run.id, "THINKING", { startedAt: new Date() });

    const timezone = await getOperationalTimezone();
    const phone = conversation.externalThreadId;
    const name =
      conversation.contact?.firstName?.trim() || conversation.participantName?.trim() || null;

    // Lo que la persona mandó en fotos o stickers, para que la IA lo vea.
    const images = await loadImages(pickImages([...conversation.messages].reverse())).catch(() => []);

    const result = await think({
      config,
      transcript: history,
      name,
      phone,
      conversationId,
      contactId: conversation.contactId,
      client: await clientContext(conversation.contactId, conversation.externalThreadId),
      memory: await getMemory(phone),
      timezone,
      mode: "live",
      images,
    });

    const meta = {
      model: result.model,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
    };

    // El último mensaje de la persona que la IA leyó. Si Dayana contestó
    // después, lo que la IA pensó ya no hace falta.
    const seen = lastInboundSeen(history, since ?? new Date());

    if (result.outcome.kind === "escalate") {
      await setStatus(run.id, "SENDING", meta);
      const escalated = await escalate(conversationId, run.id, config, result.outcome, name, meta, "ESCALATED", seen);
      // Un pago que la persona dice haber hecho: Dayana lo verifica y, con un
      // toque, manda la respuesta que la IA dejó preparada.
      if (
        escalated &&
        result.outcome.category === "payment" &&
        result.suggestedReply &&
        !(await answeredSince(conversationId, seen))
      ) {
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

    // Como lo diría Dayana: sin frases hechas, sin repetir «mi hermosa» ni el
    // corazón si ya salieron en el chat (lo que la IA lee: 2 semanas).
    const recentOutbound = history
      .filter((m) => m.direction === "OUTBOUND" && m.body)
      .map((m) => m.body as string);
    const body = polishReply(result.outcome.message, recentOutbound);
    // Mientras pensaba (unos segundos) Dayana contestó: no se envía, no se
    // propone y no se pide la cita. Ya está atendido.
    if (await answeredSince(conversationId, seen)) {
      await finish(run.id, "SKIPPED", { ...meta, reason: "replied_meanwhile" });
      return;
    }
    // O tomó el chat (modo Yo, ⭐, pausa) sin contestar todavía: la respuesta
    // queda como borrador para ella, no como propuesta.
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
    // Se vuelve a leer el modo general: pudo cambiar mientras la IA pensaba.
    const generalMode = (await getWhatsAppAiConfig()).defaultMode;
    const modeNow = effectiveAiMode(now?.aiMode ?? conversation.aiMode, generalMode);
    const tookOver =
      !now ||
      modeNow === "MANUAL" ||
      Boolean(now.aiPausedAt) ||
      Boolean(now.priorityAt) ||
      humanSince > 0;

    if (tookOver) {
      // Un borrador (lo que ella escribía no se pisa), no una propuesta: una
      // propuesta volvería a llenar «Te toca» con un chat que ya es suyo. Si lo
      // que escribió la persona importa, le toca igual que en un chat manual.
      await prisma.conversation.updateMany({
        where: { id: conversationId, OR: [{ draftBody: null }, { draftSource: "AI" }] },
        data: { draftBody: body, draftSource: "AI", draftUpdatedAt: new Date() },
      });
      await finish(run.id, "DRAFTED", { ...meta, reason: "Tomaste el chat mientras la IA pensaba: quedó de borrador." });
      await (result.bookingRequest
        ? openAttention(conversationId, "booking", seen)
        : openAttentionIfNeedsReply(conversationId)
      ).catch((e: unknown) => console.warn("[whatsapp-agent] no se pudo abrir «Te toca»", e));
      return;
    }

    // Agendar y mandar enlaces de pago siempre esperan la autorización de
    // Dayana; en copiloto, toda respuesta espera. Solo en modo IA una
    // respuesta simple sale sola. Los precios solo los da Dayana: si la
    // respuesta menciona un monto, nunca sale sola, queda como borrador para ella.
    const saysPrice = mentionsPrice(body);
    const copilot =
      modeNow === "COPILOT" || effectiveAiMode(conversation.aiMode, generalMode) === "COPILOT";
    const needsApproval =
      saysPrice ||
      Boolean(result.pendingSlots) ||
      Boolean(result.pendingBooking) ||
      Boolean(result.pendingPayment) ||
      copilot;

    // Lo mismo después de pensar, por si el modo pasó a copiloto mientras la IA
    // pensaba. Lo que pide una cita, un pago o lleva un precio sigue esperando
    // su autorización.
    const plainReply =
      !saysPrice && !result.pendingSlots && !result.pendingBooking && !result.pendingPayment && !result.bookingRequest;
    if (copilot && plainReply && !burst.needsReply) {
      await finish(run.id, "SKIPPED", { ...meta, reason: "trivial" });
      return;
    }

    if (needsApproval) {
      const proposal: Proposal = {
        kind: result.pendingSlots
          ? "slots"
          : result.pendingBooking
            ? "booking"
            : result.pendingPayment
              ? "payment_link"
              : "reply",
        message: result.pendingSlots && !body.includes("{{HORARIOS}}") ? `${body}\n\n{{HORARIOS}}` : body,
        ...(result.pendingSlots ? { slots: result.pendingSlots } : {}),
        ...(result.pendingBooking ? { booking: result.pendingBooking } : {}),
        ...(result.pendingPayment ? { payment: result.pendingPayment } : {}),
        stickerUrl: result.stickerUrl,
        ...(saysPrice
          ? { reason: "La IA escribió un precio: los precios solo los das tú. Cámbialo o descártalo." }
          : {}),
      };
      await proposeForApproval({ runId: run.id, conversationId, name, proposal, meta, important: saysPrice });
    } else {
      await setStatus(run.id, "SENDING", meta);
      await sendAuto(conversationId, body);
      if (result.stickerUrl) {
        await sendAutoSticker(conversationId, result.stickerUrl).catch((e) =>
          console.warn("[whatsapp-agent] sticker", e)
        );
      }
      await finish(run.id, "REPLIED");
      // La persona ya tiene respuesta: un «sin responder» que quedara abierto
      // se cierra (una escalada no: esa es de Dayana).
      await closeAttention(conversationId, { by: "ai" }).catch((e: unknown) =>
        console.warn("[whatsapp-agent] no se pudo cerrar «Te toca»", e)
      );
    }

    // Quiere agendar: Dayana recibe el aviso (suena) y el chat pasa a ella para
    // que agende y confirme; la IA no sigue contestando ahí. Si ella ya
    // contestó mientras tanto, no.
    if (result.bookingRequest && !(await answeredSince(conversationId, seen))) {
      const b = result.bookingRequest;
      await pauseAutoReply(conversationId, "escalation", {
        category: "booking",
        severity: "normal",
        reason: `Quiere agendar: ${b.service}${b.when ? ` · ${b.when}` : ""}`,
      });
      await openAttention(conversationId, "booking", seen);
      if (!(await answeredSince(conversationId, seen))) {
        fireNotification({
          eventType: "WHATSAPP_AI_ESCALATED",
          title: `Quiere agendar: ${name ?? conversation.participantName ?? `+${phone}`}`,
          body: [b.service, b.when ? `Le sirve: ${b.when}` : "Aún no dijo hora", b.note].filter(Boolean).join(" · ").slice(0, 200),
          href: `/admin/whatsapp?conversation=${conversationId}`,
          entityType: "Conversation",
          entityId: conversationId,
          staff: config.notify === "OWNERS" ? await ownerIds() : "ALL",
        });
      }
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
      lastHumanReplyAt: true,
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
          isEcho: true,
          source: true,
          clientKey: true,
          kind: true,
        },
      },
    },
  });

/** Las reglas que no dependen del modelo. */
const gate = async (
  conversationId: string,
  config: WhatsAppAiConfig,
  silencedBy: CategoryGate
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
  const mode = effectiveAiMode(conversation.aiMode, config.defaultMode);
  if (mode === "MANUAL") return { skip: true, reason: "manual" };
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
    // Desde lo último entre su mensaje y la pausa («Listo» la renueva aunque no escriba).
    const since = Math.max(lastHuman?.sentAt.getTime() ?? 0, conversation.aiPausedAt.getTime());
    if (Date.now() - since < config.handoffHours * 3600_000) {
      return { skip: true, reason: "paused" };
    }
    await resumeAutoReply(conversationId);
  }
  if (conversation.assignedStaffId) return { skip: true, reason: "assigned" };

  // Personal, negocio/app o equipo (con la clasificación encendida y una
  // etiqueta segura): la IA no contesta y no le toca a Dayana. Si la etiqueta
  // de la IA quedó vieja (escribió después), la IA la vuelve a mirar ahora.
  const silenced = await silencedBy({ allowAi: true });
  if (silenced) return { skip: true, reason: `category_${silenced}` };

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
    mode === "AUTO" &&
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

  const since = Date.now() - HISTORY_DAYS * 24 * 3600_000;
  const history: TranscriptLine[] = ordered
    .filter((m, i) => i >= ordered.length - HISTORY_MIN || m.sentAt.getTime() >= since)
    .filter((m) => m.status !== "FAILED")
    .map((m) => ({
      sentAt: m.sentAt,
      direction: m.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      // Un aviso gris (reacción, encuesta…) va marcado: no es algo que escribió.
      body: m.kind === "system" ? `(aviso de WhatsApp: ${m.body ?? ""})` : m.body,
      attachment: attachmentLabel(m.attachments),
      isAutoReply: m.isAutoReply,
    }));

  return { skip: false, conversation, history };
};

/**
 * Pasa el chat a Dayana: pausa la IA, abre «Te toca», manda la espera (si hay)
 * y avisa. `since`: el último mensaje de la persona que se atiende (sin él, el
 * último del chat). Si Dayana contestó después —antes o mientras tanto— no
 * hace nada de eso: queda en el rastro como «contestaste tú» y devuelve false.
 */
const escalate = async (
  conversationId: string,
  runId: string,
  config: WhatsAppAiConfig | null,
  outcome: { category: string; severity: string; reason: string },
  name?: string | null,
  meta: Prisma.WhatsAppAiRunUpdateInput = {},
  status: RunStatus = "ESCALATED",
  since?: Date | null
): Promise<boolean> => {
  const from =
    since ??
    (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { lastInboundAt: true } }))
      ?.lastInboundAt ??
    null;
  if (await answeredSince(conversationId, from)) {
    await finish(runId, "SKIPPED", { ...meta, reason: "replied_meanwhile" });
    return false;
  }
  await pauseAutoReply(conversationId, "escalation", outcome);
  // Lo que la IA había propuesto antes ya no es la respuesta: ahora le toca a
  // Dayana (y aprobarlo no debe cerrar esta escalada). La respuesta al pago
  // que la IA deja con esta escalada se propone después.
  await supersedePending(conversationId, "La IA le pasó el chat a Dayana.").catch(() => 0);
  await openAttention(conversationId, attentionReasonOf(outcome.category), from ?? new Date());
  // Si contestó justo entre la primera comprobación y abrir «Te toca», su
  // respuesta ya no lo pudo cerrar: se cierra aquí.
  const replied = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lastHumanReplyAt: true },
  });
  if (from && replied?.lastHumanReplyAt && repliedSince(replied.lastHumanReplyAt, from)) {
    await closeAttention(conversationId, { by: "reply", upTo: replied.lastHumanReplyAt });
  }
  const holding = config?.escalation.holdingMessage.trim();
  if (holding && status === "ESCALATED" && !(await answeredSince(conversationId, from))) {
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
  // Contestó justo ahora: su respuesta ya cerró «Te toca»; no se avisa.
  if (await answeredSince(conversationId, from)) return true;

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
  // Solo suena lo importante: la IA no sabe qué decir, un pago, una cita, algo
  // delicado. Una queja queda en la campana (sin push ni correo).
  const important = urgent || outcome.category !== "complaint";
  fireNotification({
    eventType: important ? "WHATSAPP_AI_ESCALATED" : "WHATSAPP_AI_INFO",
    severity: urgent ? "ERROR" : "WARNING",
    title: `${urgent ? "URGENTE — " : ""}WhatsApp: te toca${who ? ` con ${who}` : ""} (${CATEGORY_LABEL[outcome.category] ?? outcome.category})`,
    body: outcome.reason.slice(0, 200),
    href: `/admin/whatsapp?conversation=${conversationId}`,
    entityType: "Conversation",
    entityId: conversationId,
    staff: config?.notify === "OWNERS" ? await ownerIds() : "ALL",
  });
  return true;
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
