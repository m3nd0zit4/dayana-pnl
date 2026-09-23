import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import type { WhatsAppAiConfig } from "./whatsapp-ai-config";
import { getOperationalTimezone } from "./operational-timezone";
import { think, type BrainOutcome, type TranscriptLine } from "./whatsapp-agent/brain";
import type { SimilarExample } from "./whatsapp-learning";

/**
 * Respuesta automática de WhatsApp: el interruptor, la pausa por hilo y la
 * vista previa.
 *
 * Quién contesta y cómo vive en `lib/crm/whatsapp-agent/`:
 * - `run.ts` decide si toca contestar (interruptor, modo del chat, pausas,
 *   límites), espera a que la persona termine de escribir, registra el estado
 *   en vivo y envía o deja borrador;
 * - `brain.ts` es el asistente con herramientas (agenda, búsqueda en chats
 *   pasados, pasar el chat a Dayana).
 *
 * Barreras que no dependen del modelo:
 * 1. **Interruptor apagado por defecto.** Sin encenderlo no escribe nunca.
 * 2. **Modo por chat** (`Conversation.aiMode`): `MANUAL` no escribe, `COPILOT`
 *    solo deja borradores.
 * 3. **Pausa por hilo** (`aiPausedAt`): la pone la IA al escalar y cualquier
 *    mensaje escrito por Dayana. Una escalada no se levanta sola.
 * 4. **Tope por hilo y día.**
 */

const ENABLED_KEY = "whatsapp.autoreply.enabled";

/** Apagado mientras nadie lo encienda: el silencio no puede ser un accidente. */
export const isWhatsAppAutoReplyEnabled = async (): Promise<boolean> =>
  (await getSiteSetting(ENABLED_KEY)) === "true";

export const setWhatsAppAutoReplyEnabled = (enabled: boolean): Promise<void> =>
  setSiteSetting(ENABLED_KEY, String(enabled));

export type PauseReason = "human" | "escalation";

/**
 * Pausa el hilo: a partir de aquí contesta una persona.
 *
 * `human` (Dayana o el equipo escribieron) se renueva con cada mensaje suyo y
 * se levanta sola pasadas las horas de relevo. `escalation` (la IA pidió a una
 * persona) no se levanta sola: una crisis o un problema de pago no vuelve a
 * manos del robot por esperar.
 */
export const pauseAutoReply = async (
  conversationId: string,
  reason: PauseReason = "human",
  escalation?: { category: string; severity: string; reason: string }
): Promise<void> => {
  if (reason === "escalation") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiPausedAt: new Date(),
        aiPausedReason: "escalation",
        ...(escalation
          ? {
              escalationCategory: escalation.category,
              escalationSeverity: escalation.severity,
              escalationReason: escalation.reason.slice(0, 300),
            }
          : {}),
      },
    });
    return;
  }
  // Una respuesta humana no pisa una escalada pendiente.
  await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [{ aiPausedReason: null }, { aiPausedReason: { not: "escalation" } }],
    },
    data: { aiPausedAt: new Date(), aiPausedReason: "human" },
  });
};

export const resumeAutoReply = async (conversationId: string): Promise<void> => {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiPausedAt: null,
      aiPausedReason: null,
      escalationCategory: null,
      escalationSeverity: null,
      escalationReason: null,
    },
  });
};

export type ReplyDraft = {
  action: "reply" | "escalate";
  message: string;
  reason: string;
  outcome: BrainOutcome;
  examples: SimilarExample[];
  toolCalls: { tool: string; input: unknown; output: unknown }[];
};

/**
 * Lo que la IA contestaría, sin enviar nada ni agendar de verdad. Lo usan el
 * botón «Probar» del panel y el chat con el asistente.
 */
export const draftAutoReply = async (input: {
  config: WhatsAppAiConfig;
  transcript: TranscriptLine[];
  name: string | null;
  client?: string | null;
  phone?: string;
}): Promise<ReplyDraft> => {
  const result = await think({
    config: input.config,
    transcript: input.transcript,
    name: input.name,
    phone: input.phone ?? "570000000000",
    conversationId: null,
    contactId: null,
    client: input.client ?? null,
    memory: null,
    timezone: await getOperationalTimezone(),
    mode: "preview",
  });
  const o = result.outcome;
  return {
    action: o.kind,
    message: o.kind === "reply" ? o.message : input.config.escalation.holdingMessage,
    reason: o.kind === "escalate" ? `${o.category}: ${o.reason}` : "",
    outcome: o,
    examples: result.examples,
    toolCalls: result.toolCalls,
  };
};
