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
  liftPause,
  pauseAutoReply,
  resumeAutoReply,
} from "../whatsapp-autoreply";
import {
  burstState,
  isManualPause,
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
import { conversationSituation, situationText } from "./situation";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { dossierText, getDossier, updateDossier, type Dossier } from "./dossier";
import { olderSnippets } from "./context";
import { decideRoute, maxPerDayFor, strictest, type RouteDecision } from "./route";
import { segmentOrSafe } from "./segment-store";
import { isStage } from "./stage";
import { handleWaitingRoom } from "./waiting-room";
import { handleCallFollowUpReply } from "./call-outcome";
import { isCrisis, pauseHolds } from "./pause-rules";
import { wantsPaymentHelp } from "./payment-intent";
import { notifyReceipt, saveReceipt, withPaymentBlocks } from "./payment-info";
import { alreadySaid } from "./repeat-guard";
import { BREACH_HOLDING, BREACH_REASON, promiseBreach } from "./promise-guard";
import { offeredFreeCallSlots } from "./free-call";
import { getDateKeyInTz, getTimeLabelInTz } from "@/lib/datetime/zoned-time";
import { whatsAppIdVariants } from "@/lib/whatsapp-contact";
import { personFirstName } from "@/lib/person-name";

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
/**
 * Sin pausa por respuesta de Dayana: si ella escribió en el chat hace menos de
 * esto, la IA espera un poco más antes de contestar, por si Dayana está en
 * plena conversación y contesta ella.
 */
const HUMAN_LIVE_MS = 10 * 60_000;
const HUMAN_LIVE_WAIT_MS = Number(process.env.WHATSAPP_AI_HUMAN_LIVE_WAIT_MS ?? 45_000);
/** Lo que la IA le dice a la persona al pasarle algo a Dayana, si no escribió su propio aviso. */
const DEFAULT_HOLDING = "Déjame consultarlo con Dayana y te confirmo por aquí.";
/** El aviso que sale enseguida cuando lo que escribió la IA espera la aprobación de Dayana. */
const APPROVAL_HOLDING: Record<string, string> = {
  booking: "Déjame confirmar la hora con Dayana y te escribo por aquí en un momento.",
  slots: "Déjame revisar los horarios con Dayana y te escribo por aquí en un momento.",
  payment_link: "Déjame pedirle el enlace a Dayana y te lo mando por aquí.",
};

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

/**
 * El último mensaje de la persona en el chat. Meta da la hora al segundo: con
 * dos mensajes en el mismo segundo, el id (cuid, crece con el tiempo) desempata
 * igual para todas las ejecuciones, así que exactamente una se queda con la ráfaga.
 */
const latestInbound = (conversationId: string) =>
  prisma.conversationMessage.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    select: { externalMessageId: true, sentAt: true },
  });

/** ¿Llegó un mensaje de la persona después del que despertó esta vuelta? */
const newerThan = (
  latest: { externalMessageId: string | null } | null,
  triggerMessageId: string
): boolean => Boolean(latest?.externalMessageId && latest.externalMessageId !== triggerMessageId);

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
        aiModeOverride: true,
        priorityAt: true,
        aiAlwaysAt: true,
        _count: { select: { messages: true } },
      },
    });
    if (!head || head.channel !== "WHATSAPP") return;
    // «La IA responde siempre» (Dayana lo encendió en este chat difícil): gana
    // al segmento, al modo, al favorito, a la categoría y al número personal.
    // Solo la paran el interruptor general y una crisis.
    const always = Boolean(head.aiAlwaysAt);

    // Quién atiende este chat. El modo general (Ajustes) es el tope: ningún
    // chat es más suelto que él. Ya no se guarda el modo más estricto en el
    // chat (se quedaba pegado): se calcula en cada vuelta. Con el enrutador,
    // el modo sale del segmento de la persona (nueva, clienta…) o de lo que
    // Dayana eligió para este chat.
    const routeConfig = await getWhatsAppAiConfig();
    // El segmento y el estado: para el enrutador, y también con el flujo de
    // venta (aunque el enrutador esté apagado) para no ofrecerle la llamada
    // gratis a una clienta o a quien ya la tuvo.
    const segmentResult =
      (routeConfig.router.enabled || routeConfig.salesFlow.enabled) && (!head.priorityAt || always) ? await segmentOrSafe(conversationId) : null;
    let route: RouteDecision = decideRoute({
      routerEnabled: routeConfig.router.enabled,
      generalMode: routeConfig.defaultMode,
      chatMode: head.aiMode,
      override: head.aiModeOverride,
      segment: routeConfig.router.enabled ? segmentResult : null,
      modes: routeConfig.router.modes,
      always,
    });
    // Una clienta la atiende Dayana, salvo pagos: si pide los datos de pago o
    // el enlace, o manda un comprobante, la asistente se encarga (y le avisa a
    // Dayana). Nunca si Dayana tomó ese chat ni con el modo general en «Tú».
    let clientMode = false;
    if (
      enabled &&
      route.skip === "customer" &&
      head.aiModeOverride !== "MANUAL" &&
      routeConfig.defaultMode !== "MANUAL" &&
      !head.priorityAt
    ) {
      const recent = await prisma.conversationMessage.findMany({
        where: { conversationId },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: 12,
        select: { direction: true, body: true, attachments: true, kind: true },
      });
      if (wantsPaymentHelp(recent.reverse())) {
        clientMode = true;
        route = { ...route, mode: routeConfig.defaultMode, skip: null };
      }
    }

    // Sala de espera de la llamada gratis: un aviso corto y a tiempo («Dayana
    // está terminando una reunión»), aunque el chat esté en copiloto o en
    // pausa. A la hora de su llamada, la IA no se pone a conversar.
    // Si Dayana tomó el chat, lo atiende ella.
    if (enabled && (head.aiModeOverride !== "MANUAL" || always)) {
      const waiting = await handleWaitingRoom({ config: routeConfig, conversationId, triggerMessageId: input.triggerMessageId });
      if (waiting.quiet) {
        if (!waiting.sent) {
          await prisma.whatsAppAiRun.create({
            data: {
              conversationId,
              status: "SKIPPED",
              reason: "free_call_now",
              triggerMessageId: input.triggerMessageId,
              finishedAt: new Date(),
              latencyMs: 0,
            },
          });
        }
        return;
      }
      // Después de su llamada gratis: «no me llamaron» o la respuesta a
      // «¿pudiste hablar?» deciden si se hizo; si no, se le manda para reagendar.
      const followUp = await handleCallFollowUpReply({ config: routeConfig, conversationId, triggerMessageId: input.triggerMessageId });
      if (followUp.handled) return;
    }

    // Favoritos (la estrella): chats importantes para Dayana. La IA no los
    // lee, no los contesta y no los saluda.
    if (enabled && head.priorityAt && !always) {
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

    if (!enabled || route.mode === "MANUAL") {
      // Sin IA, el saludo de bienvenida (si está encendido) sigue funcionando.
      // A una clienta o a un número personal no se le saluda como nueva.
      if (route.skip !== "customer" && route.skip !== "after_call" && route.skip !== "ignored_segment") await greetIfNeeded(conversationId, silenced);
      const reason = enabled ? (route.skip ?? "manual") : "disabled";
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
    const latest = await latestInbound(conversationId);
    if (newerThan(latest, input.triggerMessageId)) {
      // Llegó otro mensaje después: esa ejecución contesta los dos.
      await prisma.whatsAppAiRun.delete({ where: { id: run.id } });
      runId = null;
      return;
    }

    // Otra vuelta ya atiende este mismo mensaje (el webhook y «Contestar
    // pendientes», o dos pasadas del reloj): se queda la primera.
    const mine = await prisma.whatsAppAiRun.findUnique({ where: { id: run.id }, select: { queuedAt: true } });
    const earlier = mine
      ? await prisma.whatsAppAiRun.count({
          where: {
            conversationId,
            triggerMessageId: input.triggerMessageId,
            id: { not: run.id },
            status: { in: ["QUEUED", "THINKING", "SENDING", "REPLIED", "DRAFTED", "AWAITING_APPROVAL"] },
            OR: [{ queuedAt: { lt: mine.queuedAt } }, { queuedAt: mine.queuedAt, id: { lt: run.id } }],
          },
        })
      : 0;
    if (earlier > 0) {
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

    // Sin pausa por respuesta de Dayana: si ella está en plena conversación
    // (escribió hace poco), la IA le da un margen para contestar ella.
    if (!routeConfig.pauses.onHumanReply) {
      const live = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { lastHumanReplyAt: true } });
      if (live?.lastHumanReplyAt && Date.now() - live.lastHumanReplyAt.getTime() < HUMAN_LIVE_MS) {
        await sleep(HUMAN_LIVE_WAIT_MS);
        if (newerThan(await latestInbound(conversationId), input.triggerMessageId)) {
          await prisma.whatsAppAiRun.delete({ where: { id: run.id } });
          runId = null;
          return;
        }
      }
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
    const verdict = await gate(conversationId, config, silenced, route);
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
          since,
          { silent: true }
        );
      } else {
        await finish(run.id, "SKIPPED", { reason: verdict.reason });
        await handOffIfNeeded(conversationId, verdict.reason, silenced);
      }
      return;
    }

    const { conversation, history, messageCount, situation } = verdict;

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
    if (route.mode === "COPILOT" && !burst.needsReply) {
      await finish(run.id, "SKIPPED", { reason: "trivial" });
      return;
    }

    // La puerta pudo tardar (la IA volvió a mirar la categoría) y esta vuelta
    // sigue en cola: la espera de arriba no la ve. Si mientras tanto escribió
    // otra vez, la vuelta de ese mensaje contesta todo y esta se retira: una
    // sola respuesta.
    if (newerThan(await latestInbound(conversationId), input.triggerMessageId)) {
      await prisma.whatsAppAiRun.delete({ where: { id: run.id } });
      runId = null;
      return;
    }

    await setStatus(run.id, "THINKING", { startedAt: new Date() });

    const timezone = await getOperationalTimezone();
    const phone = conversation.externalThreadId;
    // El que sea nombre de persona (el contacto puede llevar la frase del
    // perfil); si ninguno lo es, el del perfil, para que la IA sepa que no lo use.
    const candidates = [conversation.contact?.firstName?.trim(), conversation.participantName?.trim()];
    const name = candidates.find((n) => n && personFirstName(n)) || candidates.find(Boolean) || null;

    // Lo que la persona mandó en fotos o stickers, para que la IA lo vea.
    const images = await loadImages(pickImages([...conversation.messages].reverse())).catch(() => []);

    // La ficha (armada con todo el chat). Un chat con más historia de la que
    // la IA lee y sin ficha todavía (p. ej. recién importado) la arma ahora,
    // con tope de tiempo; lo demás lo pone al día el reloj.
    let dossier: Dossier = null;
    if (config.dossier.enabled) {
      dossier = await getDossier(conversationId).catch(() => null);
      if (!dossier && messageCount > history.length) {
        await updateDossier(conversationId, { deadline: Date.now() + 25_000 }).catch((e: unknown) =>
          console.warn("[whatsapp-agent] no se pudo armar la ficha", e)
        );
        dossier = await getDossier(conversationId).catch(() => null);
      }
    }
    // Lo viejo del mismo chat que toca lo que acaba de escribir.
    let tail = history.length;
    while (tail > 0 && history[tail - 1].direction === "INBOUND") tail--;
    const lastBurst = history
      .slice(tail)
      .map((m) => m.body ?? "")
      .join(" ");
    const older =
      config.context.v2 && config.context.snippets > 0 && history[0]?.sentAt
        ? await olderSnippets({
            conversationId,
            before: history[0].sentAt,
            query: lastBurst,
            limit: config.context.snippets,
          }).catch(() => [])
        : [];
    // Lo que leyó la IA, para poder comprobarlo después en el rastro.
    const context = {
      v2: config.context.v2,
      situation: situation ? (situation.startsWith("PERSONA NUEVA") ? "new" : "returning") : null,
      messages: messageCount,
      transcript: history.length,
      oldestAt: history[0]?.sentAt?.toISOString() ?? null,
      imported: history.filter((h) => h.imported).length,
      snippets: older.length,
      dossier: dossier ? { version: dossier.version, covered: dossier.coveredCount } : null,
    };

    // La zona de la persona: la que dijo en el chat (ficha) o la del contacto.
    const personTz =
      dossier?.timezone ??
      (config.salesFlow.enabled
        ? (await prisma.whatsAppDossier.findUnique({ where: { conversationId }, select: { timezone: true } }).catch(() => null))?.timezone
        : null) ??
      conversation.contact?.timezone ??
      null;

    const result = await think({
      config,
      transcript: history,
      name,
      phone,
      conversationId,
      contactId: conversation.contactId,
      client: await clientContext(conversation.contactId, conversation.externalThreadId, { messages: messageCount }),
      memory: await getMemory(phone),
      timezone,
      mode: "live",
      images,
      situation,
      // En qué punto está con Dayana: lo recién calculado (con el enrutador) o lo que dice la ficha.
      // Con una duda sobre si ya pagó (dice que transfirió, la clasificación
      // cree que es clienta), nada de ofrecerle la llamada gratis.
      stage:
        segmentResult && segmentResult.review && segmentResult.segment !== "client"
          ? "por_revisar"
          : (segmentResult?.stage ?? (isStage(dossier?.stage) ? dossier.stage : null)),
      dossier: dossierText(dossier),
      olderSnippets: older,
      // La llamada gratis: agenda sola solo con el enrutador, a una persona que
      // aún no es clienta, en modo IA. La zona horaria: la que dijo en el chat.
      freeCall: {
        autoBook:
          config.freeCall.autoBook &&
          route.routerEnabled &&
          route.mode === "AUTO" &&
          (route.segment === "new_lead" || route.segment === "returning_lead"),
        personTimezone: personTz,
      },
      clientMode,
    });

    const meta = {
      model: result.model,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
      context: context as unknown as Prisma.InputJsonValue,
    };

    // El último mensaje de la persona que la IA leyó. Si Dayana contestó
    // después, lo que la IA pensó ya no hace falta.
    const seen = lastInboundSeen(history, since ?? new Date());

    // Llegó un comprobante (o dijo que pagó): queda «por confirmar» y Dayana
    // recibe el aviso, conteste lo que conteste la IA.
    if (result.receipt) {
      const receiptMessage = conversation.messages.find(
        (m) =>
          m.direction === "INBOUND" &&
          Array.isArray(m.attachments) &&
          (m.attachments as { kind?: string }[]).some((a) => a.kind === "image" || a.kind === "document") &&
          Date.now() - m.sentAt.getTime() < 60 * 60_000
      );
      await saveReceipt({
        conversationId,
        contactId: conversation.contactId,
        messageId: receiptMessage?.id ?? null,
        ...result.receipt,
      })
        .then(async () =>
          notifyReceipt({
            conversationId,
            name: name ?? conversation.participantName ?? `+${phone}`,
            summary: result.receipt?.summary ?? null,
            problem: result.receipt?.problem ?? null,
            since: since ?? new Date(),
            staff: config.notify === "OWNERS" ? await ownerIds() : "ALL",
          })
        )
        .catch((e: unknown) => console.error("[whatsapp-agent] no se pudo guardar el comprobante", e));
    }

    // Con una clienta, lo que no es de pagos es de Dayana: la IA calla sin
    // avisar nada a la persona (como cualquier mensaje de una clienta). Solo
    // sale lo que comparte datos o el enlace, o recibe un comprobante.
    const paymentAnswer = Boolean(result.receipt) || result.paymentBlocks.details.length > 0 || Boolean(result.paymentBlocks.link);
    if (clientMode && (result.outcome.kind === "escalate" || !paymentAnswer)) {
      await finish(run.id, "SKIPPED", { ...meta, reason: "customer" });
      await handOffIfNeeded(conversationId, "customer", silenced);
      return;
    }

    // Lo que respalda horas y citas (la agenda de verdad, sus citas): para no
    // dejar salir promesas sin respaldo, ni en el aviso de espera.
    const backing = await promiseBacking({
      conversationId,
      contactId: conversation.contactId,
      phone,
      toolCalls: result.toolCalls,
      booking: result.booking,
      personTz: personTz ?? timezone,
      timezone,
    });

    if (result.outcome.kind === "escalate") {
      await setStatus(run.id, "SENDING", meta);
      const holdingBreach = result.holdingReply ? promiseBreach({ text: result.holdingReply, ...backing }) : null;
      const escalated = await escalate(conversationId, run.id, config, result.outcome, name, meta, "ESCALATED", seen, {
        holdingReply: holdingBreach ? BREACH_HOLDING[holdingBreach.breach] : result.holdingReply,
      });
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

    // Como lo diría Dayana: sin frases hechas, sin apodos cariñosos ni
    // corazones. Los datos de pago y el enlace van debajo, tal cual (el
    // detector de precios mira solo lo que escribió la IA: un número de cuenta
    // no es un precio).
    const written = polishReply(result.outcome.message);
    const body = withPaymentBlocks(written, { ...result.paymentBlocks, links: result.linkBlocks });
    // Mientras pensaba (unos segundos) Dayana contestó: no se envía, no se
    // propone y no se pide la cita. Ya está atendido.
    if (await answeredSince(conversationId, seen)) {
      await finish(run.id, "SKIPPED", { ...meta, reason: "replied_meanwhile" });
      return;
    }
    // El mismo comprobante otra vez («es lo de octubre, disculpa la tardanza»):
    // el comprobante se completa, pero un segundo «Ya le aviso a Dayana para
    // que lo revise» no sale si es lo último que le mandamos (Perlita, 15-oct).
    if (result.receipt && !result.paymentBlocks.details.length && !result.paymentBlocks.link && !result.linkBlocks.length) {
      const lastSent = await prisma.conversationMessage.findFirst({
        where: {
          conversationId,
          direction: "OUTBOUND",
          status: { not: "FAILED" },
          kind: "message",
          sentAt: { gte: new Date(Date.now() - 24 * 3600_000) },
        },
        orderBy: { sentAt: "desc" },
        select: { body: true },
      });
      if (alreadySaid(written, [lastSent?.body])) {
        await finish(run.id, "SKIPPED", { ...meta, reason: "repeat" });
        return;
      }
    }
    // O tomó el chat (modo Yo, ⭐, pausa) sin contestar todavía: la respuesta
    // queda como borrador para ella, no como propuesta.
    const now = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { aiMode: true, aiModeOverride: true, aiPausedAt: true, priorityAt: true, aiAlwaysAt: true },
    });
    // «La IA responde siempre» sigue encendido: sale sola. (Tomar el chat lo apaga.)
    const stillAlways = route.always && Boolean(now?.aiAlwaysAt);
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
    // Con el enrutador, lo que Dayana eligió AHORA para el chat (p. ej. lo tomó)
    // pesa sobre el modo de la vuelta; sin él, como siempre.
    const modeNow = stillAlways
      ? "AUTO"
      : route.routerEnabled
        ? strictest(generalMode, route.mode, now?.aiModeOverride ?? "AUTO")
        : effectiveAiMode(now?.aiMode ?? conversation.aiMode, generalMode);
    const tookOver =
      !now ||
      // Apagó «responde siempre» mientras pensaba: queda de borrador (el modo de esta vuelta era el del interruptor).
      (route.always && !now.aiAlwaysAt) ||
      (!stillAlways &&
        (modeNow === "MANUAL" ||
          Boolean(now.aiPausedAt) ||
          Boolean(now.priorityAt) ||
          // Sin pausa por respuesta de Dayana, que ella haya escrito antes no
          // aparta a la IA (lo que ella ya contestó lo cubre `answeredSince`).
          (config.pauses.onHumanReply && humanSince > 0))) ||
      // Una crisis que se abrió mientras pensaba la calla aunque responda siempre.
      (stillAlways && Boolean(now.aiPausedAt));

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
    const saysPrice = mentionsPrice(written);
    const copilot = modeNow === "COPILOT" || route.mode === "COPILOT";
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
      // En modo IA la persona no se queda esperando la aprobación de Dayana
      // sin nada (Rosa, 2026-10-14: «Autoriza la cita» y nadie le contestó):
      // un aviso corto ya; lo aprobado sale cuando Dayana lo acepte.
      if (!copilot && !(await answeredSince(conversationId, seen))) {
        const holding = config.escalation.holdingMessage.trim() || APPROVAL_HOLDING[proposal.kind] || DEFAULT_HOLDING;
        await sendAuto(conversationId, holding).catch((e) =>
          console.error("[whatsapp-agent] aviso mientras Dayana aprueba", e)
        );
      }
    } else {
      // Lo que no puede prometer sin respaldo (16-oct: horas inventadas y una
      // cita «confirmada» que no existía a «💙💙💜🩷» y a Sophie; «hoy mismo» a
      // Valentina). Solo lo que sale solo: una propuesta la revisa Dayana. No
      // sale: la persona recibe un aviso corto y el chat pasa a Dayana. Con
      // request_booking, la hora que pidió la persona vale (se la pasa a Dayana).
      const requested = result.bookingRequest;
      const breach = promiseBreach({
        text: written,
        ...backing,
        backing: [...backing.backing, ...(requested?.when ? [requested.when] : [])],
      });
      if (breach) {
        const asked = requested ? ` Pidió: ${requested.service}${requested.when ? ` · ${requested.when}` : ""}.` : "";
        await setStatus(run.id, "SENDING", meta);
        await escalate(
          conversationId,
          run.id,
          config,
          { category: "booking", severity: "normal", reason: `${BREACH_REASON[breach.breach]} («${breach.detail}»)${asked}` },
          name,
          meta,
          "ESCALATED",
          seen,
          { holdingReply: BREACH_HOLDING[breach.breach] }
        );
        return;
      }
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

    // Quiere agendar: Dayana recibe el aviso (suena) para que agende y
    // confirme. Con `pauses.onEscalation` apagado la IA sigue atendiendo el
    // chat (sin agendar ella). Si Dayana ya contestó mientras tanto, nada.
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

    // Con la ficha (que lee TODO el chat), la IA ya no escribe la memoria
    // (que solo veía los últimos 12 mensajes y podía contradecirla): la
    // memoria queda para las notas que escriba Dayana.
    if (!config.dossier.enabled) {
      await refreshMemory({
        phone,
        contactId: conversation.contactId,
        transcript: [...history, { direction: "OUTBOUND", body }],
      }).catch((e) => console.error("[whatsapp-agent] memoria", e));
    }
    if (config.dossier.enabled) {
      await updateDossier(conversationId, { deadline: Date.now() + 30_000 }).catch((e: unknown) =>
        console.warn("[whatsapp-agent] no se pudo poner al día la ficha", e)
      );
    }
  } catch (e) {
    console.error("[whatsapp-agent] no se pudo responder", e);
    if (runId) {
      // Ante la duda, una persona: se le avisa (y, con las pausas encendidas,
      // se pausa el hilo). «Contestar pendientes» lo vuelve a intentar.
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
        "ERROR",
        undefined,
        { silent: true }
      ).catch(() => undefined);
    }
  }
};

/**
 * Lo que respalda las horas y las citas de una respuesta (`promiseBreach`):
 * las horas que dio la agenda en esta vuelta o hace poco (quedan como
 * ofrecidas), las de sus citas activas y la que se agendó ahora, en su hora y
 * en la de Dayana.
 */
const promiseBacking = async (input: {
  conversationId: string;
  contactId: string | null;
  phone: string;
  toolCalls: { tool: string; input: unknown; output: unknown }[];
  booking: { startsAt: Date } | null;
  personTz: string;
  timezone: string;
  now?: Date;
}): Promise<{ backing: string[]; hasBooking: boolean; bookingToday: boolean }> => {
  const now = input.now ?? new Date();
  const labels: string[] = [];
  let bookedNow = Boolean(input.booking);
  for (const t of input.toolCalls) {
    const out = (t.output ?? {}) as { options?: { label?: unknown }[]; label?: unknown; booked?: unknown; alreadyBooked?: unknown };
    // Las horas que dio la agenda (la llamada gratis o, con «agendar sola», check_availability).
    if ((t.tool === "offer_free_call_slots" || t.tool === "check_availability") && Array.isArray(out.options)) {
      for (const o of out.options) if (typeof o.label === "string") labels.push(o.label);
    }
    if (typeof out.label === "string") labels.push(out.label);
    if (t.tool === "book_free_call" && (out.booked === true || out.alreadyBooked === true)) bookedNow = true;
    if ((t.tool === "book_appointment" || t.tool === "confirm_appointment") && (out as { ok?: unknown }).ok === true) bookedNow = true;
  }
  const [offered, dayanaLines, appts] = await Promise.all([
    offeredFreeCallSlots(input.conversationId, now).catch(() => [] as string[]),
    // Las horas que Dayana misma escribió (el botón «Horas libres», su celular) también valen.
    prisma.conversationMessage
      .findMany({
        where: {
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          isAutoReply: false,
          kind: "message",
          status: { not: "FAILED" },
          sentAt: { gte: new Date(now.getTime() - 72 * 3600_000) },
        },
        orderBy: { sentAt: "desc" },
        select: { body: true },
        take: 30,
      })
      .catch(() => [] as { body: string | null }[]),
    // Sus citas: por el chat, por el contacto o por el número (una cita sincronizada puede no tener chat).
    prisma.calendarAppointment
      .findMany({
        where: {
          status: "active",
          endsAt: { gte: now },
          OR: [
            { conversationId: input.conversationId },
            ...(input.contactId ? [{ contactId: input.contactId }] : []),
            ...(/^\d+$/.test(input.phone) ? [{ phone: { in: whatsAppIdVariants(input.phone) } }] : []),
          ],
        },
        select: { startsAt: true },
        take: 10,
      })
      .catch(() => [] as { startsAt: Date }[]),
  ]);
  for (const l of dayanaLines) if (l.body) labels.push(l.body);
  const booked = [...appts.map((a) => a.startsAt), ...(input.booking ? [input.booking.startsAt] : [])];
  for (const d of [...offered.map((iso) => new Date(iso)), ...booked]) {
    if (Number.isNaN(d.getTime())) continue;
    labels.push(getTimeLabelInTz(d, input.personTz), getTimeLabelInTz(d, input.timezone));
  }
  const today = (tz: string) => getDateKeyInTz(now, tz);
  return {
    backing: labels,
    hasBooking: bookedNow || booked.length > 0,
    bookingToday: booked.some(
      (d) => getDateKeyInTz(d, input.timezone) === today(input.timezone) || getDateKeyInTz(d, input.personTz) === today(input.personTz)
    ),
  };
};

type GateResult =
  | { skip: true; reason: string; escalate?: boolean }
  | {
      skip: false;
      conversation: NonNullable<Awaited<ReturnType<typeof loadConversation>>>;
      history: TranscriptLine[];
      /** Mensajes del chat que se cargaron (sin avisos grises). */
      messageCount: number;
      /** «SITUACIÓN DEL CHAT» sobre todo el chat (solo con `context.v2`). */
      situation: string | null;
    };

const loadConversation = (conversationId: string) =>
  prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      aiMode: true,
      aiPausedAt: true,
      aiPausedReason: true,
      escalationCategory: true,
      escalationSeverity: true,
      escalationReason: true,
      category: true,
      priorityAt: true,
      assignedStaffId: true,
      externalThreadId: true,
      contactId: true,
      participantName: true,
      lastHumanReplyAt: true,
      contact: {
        select: {
          firstName: true,
          timezone: true,
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
          externalMessageId: true,
        },
      },
    },
  });

/** Las reglas que no dependen del modelo. */
const gate = async (
  conversationId: string,
  config: WhatsAppAiConfig,
  silencedBy: CategoryGate,
  route: RouteDecision
): Promise<GateResult> => {
  // «La IA responde siempre» en este chat: no la apartan el horario, el
  // favorito, la categoría, la libreta ni el número personal. Sí una crisis
  // (o una pausa que Dayana puso a mano) y lo que Dayana ya contestó.
  const always = route.always;
  if (
    !always &&
    config.schedule.mode === "outside_hours" &&
    isWithinOwnerHours(config.schedule, new Date(), await getOperationalTimezone())
  ) {
    return { skip: true, reason: "owner_hours" };
  }

  const conversation = await loadConversation(conversationId);
  if (!conversation) return { skip: true, reason: "not_found" };
  const mode = route.mode;
  if (mode === "MANUAL") return { skip: true, reason: route.skip ?? "manual" };
  if (conversation.priorityAt && !always) return { skip: true, reason: "favorite" };

  const crisis = isCrisis({ category: conversation.escalationCategory, severity: conversation.escalationSeverity });
  if (conversation.aiPausedAt && always && !crisis) {
    // Con «responde siempre» solo calla la pausa que Dayana puso a mano;
    // cualquier otra (su respuesta, una escalada normal) se levanta. «Te toca»
    // queda para ella. Una crisis nunca se levanta aquí (ni una escrita entre medio).
    const byHand =
      conversation.aiPausedReason === "escalation" &&
      isManualPause({ category: conversation.escalationCategory, reason: conversation.escalationReason });
    if (byHand) return { skip: true, reason: "paused" };
    await liftPause(conversationId, { keepCrisis: "any" });
  } else if (conversation.aiPausedAt && always && conversation.aiPausedReason === "escalation") {
    // Una crisis que espera a Dayana: callada hasta «Listo».
    return { skip: true, reason: "paused" };
  } else if (conversation.aiPausedAt) {
    // (Una crisis que Dayana ya atendió con «Listo» sigue el relevo normal, también con «responde siempre».)
    const holds = pauseHolds(
      {
        reason: conversation.aiPausedReason,
        escalationCategory: conversation.escalationCategory,
        escalationSeverity: conversation.escalationSeverity,
        escalationReason: conversation.escalationReason,
      },
      config.pauses
    );
    // Una pausa que ya no corre (la IA contesta siempre salvo a clientas): se
    // levanta y sigue. Lo de «Te toca» queda para Dayana.
    if (!holds) {
      await liftPause(conversationId);
    } else if (conversation.aiPausedReason === "escalation" || config.handoffHours === 0) {
      // Una escalada espera a una persona. Una pausa por respuesta humana se
      // levanta sola si Dayana lleva las horas de relevo sin escribir aquí.
      return { skip: true, reason: "paused" };
    } else {
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
  }
  if (conversation.assignedStaffId && !always) return { skip: true, reason: "assigned" };

  // Personal, negocio/app o equipo (con la clasificación encendida y una
  // etiqueta segura): la IA no contesta y no le toca a Dayana. Aquí solo las
  // reglas y lo guardado; una etiqueta vieja de la IA se vuelve a mirar al
  // final, cuando ya pasó todo lo que no cuesta nada.
  const silenced = always ? null : await silencedBy({ allowAi: false });
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
    config.pauses.onHumanReply &&
    mode === "AUTO" &&
    !always &&
    lastHumanAt &&
    (config.handoffHours === 0 ||
      Date.now() - lastHumanAt.getTime() < config.handoffHours * 3600_000)
  ) {
    await pauseAutoReply(conversationId);
    return { skip: true, reason: "human_replied" };
  }

  // Libreta personal del celular (familia, amigos): si está ahí, no es alguien
  // del CRM y nunca ha tenido un chat de trabajo, no es un cliente escribiendo.
  // Un contacto guardado en el celular puede ser una interesada: si el chat ya
  // es de trabajo (interesada, clienta, comunidad), se le contesta.
  const workChat = conversation.category === "interesada" || conversation.category === "cliente" || conversation.category === "comunidad";
  if (config.audience.skipKnownContacts && !always && !workChat && !conversation.contactId) {
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
  // Dayana marcó el número como personal (familia, amigos): nunca contesta.
  if (!always && (await isIgnoredNumber(conversation.externalThreadId))) return { skip: true, reason: "personal_number" };
  // Con el enrutador, las clientas (también las que pagaron por fuera) ya se
  // apartaron arriba por su segmento.
  if (!always && !route.routerEnabled && config.audience.skipCustomers && (conversation.contact?.enrollments.length ?? 0) > 0) {
    return { skip: true, reason: "customer" };
  }

  const autoToday = await prisma.conversationMessage.count({
    where: {
      conversationId,
      isAutoReply: true,
      sentAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  if (autoToday >= maxPerDayFor(config, route.segment, always)) {
    return { skip: true, escalate: true, reason: "Demasiadas respuestas automáticas hoy en este chat." };
  }

  // La etiqueta de la IA callaría pero quedó vieja (escribió después): la IA
  // la vuelve a mirar ahora, una llamada corta. Al final, para no gastarla en
  // un chat que igual se iba a saltar. Si falla o tarda, no calla.
  const refreshed = always ? null : await silencedBy({ allowAi: true });
  if (refreshed) return { skip: true, reason: `category_${refreshed}` };

  // Sin clave del modelo no hay respuesta. Al final (antes iba primero) para
  // que las pruebas sin clave vean que todo lo de arriba dejó pasar el chat.
  if (!process.env.GEMINI_API_KEY?.trim()) return { skip: true, reason: "no_model_key" };

  // v2: los últimos N mensajes, sean de cuando sean. Antes: 2 semanas o los
  // últimos 40, y quien volvía tras un mes leía un hilo casi vacío.
  const since = Date.now() - HISTORY_DAYS * 24 * 3600_000;
  const recent = config.context.v2
    ? ordered.slice(-config.context.recentMessages)
    : ordered.filter((m, i) => i >= ordered.length - HISTORY_MIN || m.sentAt.getTime() >= since);
  const history: TranscriptLine[] = recent
    .filter((m) => m.status !== "FAILED")
    .map((m) => ({
      sentAt: m.sentAt,
      direction: m.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      // Un aviso gris (reacción, encuesta…) va marcado: no es algo que escribió.
      body: m.kind === "system" ? `(aviso de WhatsApp: ${m.body ?? ""})` : m.body,
      attachment: attachmentLabel(m.attachments),
      isAutoReply: m.isAutoReply,
      // Los chats exportados del celular se guardan con id `export:…`.
      imported: m.externalMessageId?.startsWith("export:") || undefined,
    }));

  const situation = config.context.v2
    ? situationText(
        conversationSituation(
          ordered.map((m) => ({
            direction: m.direction === "INBOUND" ? ("INBOUND" as const) : ("OUTBOUND" as const),
            kind: m.kind,
            source: m.source,
            clientKey: m.clientKey,
            status: m.status,
          }))
        ),
        Boolean(conversation.contactId)
      )
    : null;
  const messageCount = ordered.filter((m) => m.kind !== "system").length;

  return { skip: false, conversation, history, messageCount, situation };
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
  since?: Date | null,
  opts: {
    /** El aviso corto que escribió la IA para la persona. */
    holdingReply?: string | null;
    /** Sin aviso a la persona (tope del día, fallo de la IA). */
    silent?: boolean;
  } = {}
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
  // Ya le tocaba por lo mismo (la persona insiste): no vuelve a sonar.
  const before = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { attentionAt: true, attentionReason: true },
  });
  const alreadyOpen = Boolean(before?.attentionAt) && before?.attentionReason === attentionReasonOf(outcome.category);
  // Con `pauses.onEscalation` apagado, la IA avisa y sigue atendiendo el chat
  // (salvo lo delicado: una crisis o algo urgente siempre la calla).
  const paused = await pauseAutoReply(conversationId, "escalation", outcome);
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
  // Callada (lo de antes): solo el mensaje de espera de Ajustes, si lo hay.
  // Sin callarse: la persona nunca se queda sin respuesta (el aviso de la IA,
  // el de Ajustes o uno corto por defecto).
  const configured = config?.escalation.holdingMessage.trim() || null;
  // El aviso de la IA pasa por lo mismo que cualquier respuesta: sin apodos y,
  // si se le escapó un precio, el de Ajustes o el corto por defecto.
  const written = opts.holdingReply?.trim() ? polishReply(opts.holdingReply) : null;
  const ownHolding = written && !mentionsPrice(written) ? written : null;
  const holding = opts.silent ? null : paused ? configured : ownHolding || configured || DEFAULT_HOLDING;
  // Si lo último que le mandamos ya es este mismo aviso («Déjame avisarle a
  // Dayana…» cuatro veces seguidas, 14-oct), no se repite: lo tiene a la vista
  // y Dayana ya está avisada.
  const lastSent = holding
    ? await prisma.conversationMessage.findFirst({
        where: {
          conversationId,
          direction: "OUTBOUND",
          status: { not: "FAILED" },
          sentAt: { gte: new Date(Date.now() - 24 * 3600_000) },
        },
        orderBy: { sentAt: "desc" },
        select: { body: true },
      })
    : null;
  const repeated = Boolean(holding) && alreadySaid(holding!, [lastSent?.body]);
  if (holding && !repeated && status === "ESCALATED" && !(await answeredSince(conversationId, from))) {
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
  // Sin pausa y ya le tocaba por lo mismo: ya lo sabe, no vuelve a sonar.
  if (!paused && alreadyOpen && outcome.severity !== "urgent") return true;

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
