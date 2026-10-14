import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "./whatsapp-ai-config";
import { isManualPause } from "./whatsapp-attention-rules";
import { escalationPauses } from "./whatsapp-agent/pause-rules";
import { withPaymentBlocks } from "./whatsapp-agent/payment-info";
import { polishReply } from "./whatsapp-agent/wording";
import { getOperationalTimezone } from "./operational-timezone";
import { isSensitiveEscalation } from "./whatsapp-attention-rules";
import { clearEscalationAttention } from "./whatsapp-agent/attention";
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
 *    mensaje escrito por Dayana. Una escalada no se levanta sola: espera a
 *    que ella conteste o pulse «Listo» (y entonces pasa a pausa humana).
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
 * Pausa el hilo: a partir de aquí contesta una persona. Devuelve si pausó.
 *
 * `human` (Dayana o el equipo escribieron) se renueva con cada mensaje suyo y
 * se levanta sola pasadas las horas de relevo. `escalation` (la IA pidió a una
 * persona) no se levanta por esperar: una crisis o un problema de pago no
 * vuelve a manos del robot solo. Cuando Dayana contesta o pulsa «Listo», la
 * escalada pasa a `human` (`whatsapp-agent/attention.ts`) y desde ahí corre
 * el relevo como con cualquier respuesta suya.
 *
 * Con los interruptores de `pauses` apagados (lo normal desde 2026-10-14, la
 * IA contesta siempre salvo a clientas) no pausa ni por una respuesta de
 * Dayana ni por una escalada de la IA. Siempre pausa lo que pausó Dayana a
 * mano (sin escalada o con «Pausar») y lo delicado (crisis, urgente).
 */
export const pauseAutoReply = async (
  conversationId: string,
  reason: PauseReason = "human",
  escalation?: { category: string; severity: string; reason: string }
): Promise<boolean> => {
  if (reason === "escalation") {
    const byHand = !escalation || isManualPause({ category: escalation.category, reason: escalation.reason });
    if (!byHand) {
      const { pauses } = await getWhatsAppAiConfig();
      if (!escalationPauses(escalation, pauses)) return false;
    }
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
    return true;
  }
  const { pauses } = await getWhatsAppAiConfig();
  if (!pauses.onHumanReply) return false;
  // Una respuesta humana no pisa una escalada pendiente.
  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [{ aiPausedReason: null }, { aiPausedReason: { not: "escalation" } }],
    },
    data: { aiPausedAt: new Date(), aiPausedReason: "human" },
  });
  return updated.count > 0;
};

/**
 * Levanta una pausa que ya no corre (los interruptores de `pauses` se
 * apagaron después de ponerla) sin cerrar lo que abrió en «Te toca»: Dayana
 * sigue viendo que algo la necesitaba.
 */
export const liftPause = async (conversationId: string): Promise<void> => {
  await prisma.conversation.updateMany({
    where: { id: conversationId, aiPausedAt: { not: null } },
    data: { aiPausedAt: null, aiPausedReason: null, escalationCategory: null, escalationSeverity: null, escalationReason: null },
  });
};

/**
 * La IA vuelve a contestar en el hilo («Devolver a la IA», cambiar el modo,
 * reanudar desde el agente…). Si había una escalada, lo que esa escalada abrió
 * en «Te toca» se cierra con ella; un «sin responder» se queda.
 *
 * Una escalada delicada (clínica, pago, urgente) NO se levanta así: sigue en
 * pausa, en «Te toca» y con su aviso hasta que Dayana pulse «Listo». Solo
 * confirmar un pago (`allowPayment`) puede devolver un pago a la IA —para eso
 * está—, nunca algo clínico o urgente. Devuelve si la IA quedó atendiendo.
 */
export const resumeAutoReply = async (
  conversationId: string,
  opts: { allowPayment?: boolean } = {}
): Promise<boolean> => {
  const before = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { aiPausedReason: true, escalationCategory: true, escalationSeverity: true },
  });
  if (!before) return false;
  if (before.aiPausedReason === "escalation") {
    const escalation = { category: before.escalationCategory, severity: before.escalationSeverity };
    const paymentOnly = escalation.category === "payment" && escalation.severity !== "urgent";
    if (isSensitiveEscalation(escalation) && !(opts.allowPayment && paymentOnly)) return false;
    await clearEscalationAttention(conversationId);
  }
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
  return true;
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
  // Tal como saldría: sin apodos, con los datos de pago debajo y, al escalar,
  // el aviso que recibe la persona.
  const holding = input.config.pauses.onEscalation
    ? input.config.escalation.holdingMessage
    : result.holdingReply || input.config.escalation.holdingMessage || "Déjame consultarlo con Dayana y te confirmo por aquí.";
  return {
    action: o.kind,
    message: o.kind === "reply" ? withPaymentBlocks(polishReply(o.message), result.paymentBlocks) : holding,
    reason: o.kind === "escalate" ? `${o.category}: ${o.reason}` : "",
    outcome: o,
    examples: result.examples,
    toolCalls: result.toolCalls,
  };
};
