import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
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
    }[]
  >`
    SELECT c.id, c.participant_name AS name, c.external_thread_id AS phone, c.last_inbound_at,
           c.ai_paused_at, c.ai_paused_reason, c.escalation_category, c.escalation_severity, c.escalation_reason,
           (SELECT m.external_message_id FROM conversation_messages m
             WHERE m.conversation_id = c.id AND m.direction = 'INBOUND'
             ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS trigger_id
      FROM conversations c
      LEFT JOIN whatsapp_dossiers d ON d.conversation_id = c.id
     WHERE c.channel = 'WHATSAPP'
       AND c.last_inbound_at > now() - interval '23 hours'
       AND c.last_inbound_at < now() - make_interval(mins => ${opts.minAgeMin ?? 10})
       AND c.priority_at IS NULL
       AND (c.ai_mode_override IS NULL OR c.ai_mode_override <> 'MANUAL')
       AND c.assigned_staff_id IS NULL
       AND (d.segment IS NULL OR d.segment <> 'ignored')
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
        !pauseHolds(
          {
            reason: r.ai_paused_reason,
            escalationCategory: r.escalation_category,
            escalationSeverity: r.escalation_severity,
            escalationReason: r.escalation_reason,
          },
          config.pauses
        )
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
