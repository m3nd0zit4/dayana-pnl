import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { markReadByEntity } from "@/lib/notifications/platform/feed";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import { isManualPause } from "../whatsapp-attention-rules";
import { pauseHolds } from "./pause-rules";
import { runWhatsAppAi } from "./run";

/**
 * Chats que se quedaron sin respuesta: la persona escribió (dentro de la
 * ventana de 24 h de WhatsApp) y nadie le contestó, porque la IA estaba en
 * pausa (Dayana había contestado antes, una escalada, el tope del día) o
 * porque falló. La IA los vuelve a mirar como si acabaran de llegar: el
 * ejecutor decide igual que siempre (una clienta sigue siendo de Dayana).
 *
 * Lo usan el reloj (cada 10 min, lo que lleva más de 10 min sin respuesta) y
 * el botón «Contestar pendientes».
 */

/** Por qué una vuelta anterior no contestó y vale la pena volver a intentarlo (las reglas cambiaron). */
const RETRYABLE_SKIPS = ["paused", "human_replied", "known_contact", "disabled", "owner_hours"];

export type PendingChat = { conversationId: string; triggerMessageId: string; name: string; lastInboundAt: Date };

export const findUnansweredChats = async (opts: {
  /** Minutos que lleva sin respuesta (la vuelta normal ya tuvo su oportunidad). */
  minAgeMin?: number;
  limit?: number;
  /** También lo que la IA escaló sin contestar (antes la escalada la callaba). */
  includeEscalated?: boolean;
  /** No lo intenta si hubo una vuelta en estos minutos (el reloj espera una hora entre intentos). */
  recentRunMin?: number;
}): Promise<PendingChat[]> => {
  const config = await getWhatsAppAiConfig();
  const retryable = opts.includeEscalated ? Prisma.sql`OR r.status = 'ESCALATED'` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string | null;
      phone: string;
      last_inbound_at: Date;
      trigger_id: string | null;
      ai_paused_at: Date | null;
      ai_paused_reason: string | null;
      escalation_category: string | null;
      escalation_severity: string | null;
      escalation_reason: string | null;
      ai_always_at: Date | null;
    }[]
  >`
    SELECT c.id, c.participant_name AS name, c.external_thread_id AS phone, c.last_inbound_at,
           c.ai_paused_at, c.ai_paused_reason, c.escalation_category, c.escalation_severity, c.escalation_reason,
           c.ai_always_at,
           (SELECT m.external_message_id FROM conversation_messages m
             WHERE m.conversation_id = c.id AND m.direction = 'INBOUND'
             ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS trigger_id
      FROM conversations c
      LEFT JOIN whatsapp_dossiers d ON d.conversation_id = c.id
     WHERE c.channel = 'WHATSAPP'
       AND c.last_inbound_at > now() - interval '23 hours'
       AND c.last_inbound_at < now() - make_interval(mins => ${opts.minAgeMin ?? 10})
       -- «La IA responde siempre» entra aunque sea favorito, esté tomado o sea personal.
       AND (c.priority_at IS NULL OR c.ai_always_at IS NOT NULL)
       AND (c.ai_mode_override IS NULL OR c.ai_mode_override <> 'MANUAL' OR c.ai_always_at IS NOT NULL)
       AND (c.assigned_staff_id IS NULL OR c.ai_always_at IS NOT NULL)
       AND (d.segment IS NULL OR d.segment <> 'ignored' OR c.ai_always_at IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages o
          WHERE o.conversation_id = c.id AND o.direction = 'OUTBOUND'
            AND o.sent_at >= c.last_inbound_at AND o.status <> 'FAILED'
       )
       AND NOT EXISTS (
         SELECT 1 FROM whatsapp_ai_runs r
          WHERE r.conversation_id = c.id
            AND (r.status IN ('AWAITING_APPROVAL', 'QUEUED', 'THINKING', 'SENDING')
                 OR r.queued_at > now() - make_interval(mins => ${opts.recentRunMin ?? 10}))
       )
       AND NOT EXISTS (
         SELECT 1 FROM whatsapp_ai_runs r
          WHERE r.conversation_id = c.id AND r.queued_at >= c.last_inbound_at - interval '1 second'
            AND NOT ((r.status = 'SKIPPED' AND r.reason IN (${Prisma.join(RETRYABLE_SKIPS)})) OR r.status = 'ERROR' ${retryable})
       )
     ORDER BY c.last_inbound_at DESC
     LIMIT ${opts.limit ?? 50}`;
  return rows
    .filter((r) => r.trigger_id)
    .filter(
      (r) =>
        !r.ai_paused_at ||
        // Con «responde siempre» solo calla la pausa que puso Dayana a mano (ni una
        // crisis: la IA nunca deja de responder, dueño 21-oct).
        (r.ai_always_at
          ? !(r.ai_paused_reason === "escalation" && isManualPause({ category: r.escalation_category, reason: r.escalation_reason }))
          : !pauseHolds(
              {
                reason: r.ai_paused_reason,
                escalationCategory: r.escalation_category,
                escalationSeverity: r.escalation_severity,
                escalationReason: r.escalation_reason,
              },
              config.pauses
            ))
    )
    .map((r) => ({
      conversationId: r.id,
      triggerMessageId: r.trigger_id as string,
      name: r.name ?? `+${r.phone}`,
      lastInboundAt: r.last_inbound_at,
    }));
};

/** Le pasa a la IA los chats sin respuesta, de a pocos a la vez, hasta `budgetMs`. */
export const answerUnansweredChats = async (opts: {
  budgetMs: number;
  minAgeMin?: number;
  limit?: number;
  includeEscalated?: boolean;
  recentRunMin?: number;
  concurrency?: number;
}): Promise<{ found: number; started: number; remaining: number; disabled?: boolean }> => {
  if (!(await isWhatsAppAutoReplyEnabled())) return { found: 0, started: 0, remaining: 0, disabled: true };
  const deadline = Date.now() + opts.budgetMs;
  const chats = await findUnansweredChats(opts);
  const queue = [...chats];
  let started = 0;
  const worker = async () => {
    // Cada vuelta tarda ~10–60 s (espera, modelo, envío): no empieza una que no alcance a terminar.
    while (queue.length > 0 && Date.now() < deadline - 70_000) {
      const chat = queue.shift();
      if (!chat) break;
      started++;
      await runWhatsAppAi({ conversationId: chat.conversationId, triggerMessageId: chat.triggerMessageId }).catch((e: unknown) =>
        console.warn("[pendientes] no se pudo contestar", chat.conversationId, e)
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return { found: chats.length, started, remaining: queue.length };
};

/**
 * Al encender «La IA responde siempre» en un chat: si lo último es de la
 * persona (dentro de las 23 h, la ventana de WhatsApp) y nadie le contestó, la
 * IA lo contesta ya, sin esperar a que vuelva a escribir. El ejecutor decide
 * igual que siempre (no repite lo que Dayana ya contestó). Devuelve si lo intentó.
 */
export const answerIfPending = async (conversationId: string): Promise<boolean> => {
  if (!(await isWhatsAppAutoReplyEnabled())) return false;
  const last = await prisma.conversationMessage.findFirst({
    where: { conversationId, kind: "message", status: { not: "FAILED" } },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    select: { direction: true, externalMessageId: true, sentAt: true },
  });
  if (!last || last.direction !== "INBOUND" || !last.externalMessageId) return false;
  if (Date.now() - last.sentAt.getTime() > 23 * 3600_000) return false;
  // Lo que la IA dejó para ese mensaje cuando no podía contestar sola (una
  // respuesta por autorizar en copiloto, un borrador porque el chat era de
  // Dayana) queda atrás: ahora contesta ella. Si no, la vuelta nueva se
  // retira al verla. Lo que pide una cita o un pago sigue esperando a Dayana.
  const earlier = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, triggerMessageId: last.externalMessageId, status: { in: ["AWAITING_APPROVAL", "DRAFTED"] } },
    select: { id: true, status: true, proposal: true },
  });
  const kindOf = (p: unknown) => (p as { kind?: string } | null)?.kind ?? "reply";
  if (earlier.some((r) => r.status === "AWAITING_APPROVAL" && kindOf(r.proposal) !== "reply")) return false;
  if (earlier.length) {
    await prisma.whatsAppAiRun.updateMany({
      where: { id: { in: earlier.map((r) => r.id) }, status: { in: ["AWAITING_APPROVAL", "DRAFTED"] } },
      data: { status: "CANCELLED", reason: "«La IA responde siempre»: la IA contesta sola.", decidedAt: new Date() },
    });
    // El borrador de la IA en la caja de escribir (lo que escribía Dayana no se toca).
    await prisma.conversation.updateMany({
      where: { id: conversationId, draftSource: "AI" },
      data: { draftBody: null, draftSource: null, draftUpdatedAt: null },
    });
    const left = await prisma.whatsAppAiRun.count({ where: { conversationId, status: "AWAITING_APPROVAL" } });
    if (left === 0) {
      await markReadByEntity({ entityType: "Conversation", entityId: conversationId, eventTypes: ["WHATSAPP_AI_APPROVAL"] }).catch(() => 0);
    }
  }
  await runWhatsAppAi({ conversationId, triggerMessageId: last.externalMessageId });
  return true;
};
