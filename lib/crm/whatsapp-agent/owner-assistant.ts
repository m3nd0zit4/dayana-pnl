import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { draftAutoReply } from "../whatsapp-autoreply";
import { modelId } from "./brain";
import { previewConfigPatch } from "./config-patch";
import { getMemory } from "./memory";
import { listPlaybooks, playbookSchema } from "./playbooks";
import { getOverview, listChats } from "./workspace";

/**
 * El chat de Dayana con su asistente de WhatsApp (sección WhatsApp →
 * Asistente).
 *
 * Aquí Dayana le habla a la IA como a una empleada: «¿cómo te fue hoy?»,
 * «no le hables de precios a quien pregunte por el taller hasta saber su
 * país», «las llamadas de valoración son de 30 minutos», «¿qué le dirías a
 * alguien que pregunta si atiendo parejas?». El asistente lee su propia
 * configuración, sus procedimientos y su historial, y propone cambios.
 *
 * Nada se cambia solo: cada cambio sale como una **propuesta** con su resumen
 * y Dayana la aplica con un toque (lo mismo que la aprobación de comandos de
 * Hermes Agent). Así un malentendido del modelo nunca reescribe la
 * configuración a sus espaldas.
 */

export type Proposal =
  | { type: "config"; summary: string; patch: Record<string, unknown>; changed: string[] }
  | {
      type: "playbook";
      summary: string;
      playbook: { id?: string; name: string; trigger: string; steps: string };
    }
  | { type: "memory"; summary: string; phone: string; conversationId: string | null; notes: string }
  | {
      type: "chat_mode";
      summary: string;
      conversationId: string;
      mode: "AUTO" | "COPILOT" | "MANUAL";
      priority?: boolean;
    };

export type AssistantTurn = {
  text: string;
  proposals: Proposal[];
  steps: { tool: string; input: unknown }[];
};

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

const SYSTEM = `Eres el asistente de WhatsApp de Dayana Beltrán (terapeuta). Hablas con Dayana, tu jefa, en español, de tú, breve y claro.

Tu trabajo en este chat:
- Contarle cómo va WhatsApp (usa get_status): cuántos chats atendiste, cuáles te pasaron a ella y por qué, citas agendadas, fallas.
- Configurarte según lo que ella diga. Lee primero get_config o list_playbooks y luego PROPÓN el cambio con propose_config_change, propose_playbook, propose_memory o propose_chat_mode. Nunca digas que ya quedó aplicado: queda como propuesta y ella la aplica con el botón «Aplicar».
- Reglas de trato, tono, qué decir o no decir en un caso → normalmente un procedimiento (propose_playbook) o las instrucciones (config.instructions).
- Horarios de citas, duración de servicios, Meet, antelación → config.booking.
- Cuándo contestas (siempre / fuera de su horario), a quién (libreta, clientas), límites, a quién avisar → config.
- Mostrarle cómo contestarías algo con simulate_reply.
- Buscar un chat con find_chat para ponerlo en manual, copiloto o prioridad.

Campos de la configuración (config): identity (assistant|owner), audience {skipKnownContacts, skipCustomers}, schedule {mode: always|outside_hours, days[0-6], start "HH:MM", end}, maxPerDay, handoffHours, bookingUrl, instructions (texto, máx 3000), styleGuide (máx 4000), learning {enabled, examples}, notify (ALL|OWNERS), defaultMode (AUTO|COPILOT), diagnosticOutreach {enabled: escribirle por WhatsApp a quien termina la autoevaluación, requireApproval: dejarlo para que Dayana lo apruebe}, booking {enabled, accountId, hours [{weekday 0-6, from, to}], bufferMin, minNoticeHours, horizonDays, services [{name, minutes}], addMeet}, escalation {holdingMessage: texto que se le dice a la persona al pasar el chat; vacío = silencio}.

Al proponer cambios a instructions o styleGuide, conserva lo que ya hay y agrega o edita solo lo necesario. Una propuesta por tema. Explica en una frase qué cambiará.`;

export const runOwnerAssistant = async (
  messages: ModelMessage[]
): Promise<AssistantTurn> => {
  const proposals: Proposal[] = [];
  const steps: AssistantTurn["steps"] = [];
  const log = (name: string, input: unknown) => steps.push({ tool: name, input });

  const tools = {
    get_status: tool({
      description: "Cómo va WhatsApp: estado de conexión, números de las últimas 24 h y últimas decisiones.",
      inputSchema: z.object({}),
      execute: async () => {
        log("get_status", {});
        const o = await getOverview();
        return {
          enabled: o.enabled,
          last24h: o.kpis,
          health: o.health,
          recent: o.runs.slice(0, 25).map((r) => ({
            chat: r.name,
            status: r.status,
            reason: r.reason,
            category: r.category,
            at: r.queuedAt,
            seconds: r.latencyMs ? Math.round(r.latencyMs / 1000) : null,
          })),
        };
      },
    }),
    get_config: tool({
      description: "Lee tu configuración actual completa.",
      inputSchema: z.object({}),
      execute: async () => {
        log("get_config", {});
        return getWhatsAppAiConfig();
      },
    }),
    propose_config_change: tool({
      description:
        "Propone un cambio parcial a la configuración. `patch` tiene solo los campos a cambiar (los objetos se mezclan; las listas se reemplazan enteras).",
      inputSchema: z.object({
        summary: z.string().max(300).describe("Qué cambia, para Dayana."),
        patch: z.record(z.string(), z.unknown()),
      }),
      execute: async ({ summary, patch }) => {
        log("propose_config_change", { summary, patch });
        const preview = await previewConfigPatch(patch);
        if (!preview.ok) return { error: `No es válido: ${preview.error}. Corrige y vuelve a proponer.` };
        if (preview.changed.length === 0) return { note: "Eso ya está así; no hay nada que cambiar." };
        proposals.push({ type: "config", summary, patch, changed: preview.changed });
        return { proposed: true, changed: preview.changed };
      },
    }),
    list_playbooks: tool({
      description: "Tus procedimientos (activos y propuestos).",
      inputSchema: z.object({}),
      execute: async () => {
        log("list_playbooks", {});
        return (await listPlaybooks()).map((p) => ({
          id: p.id,
          name: p.name,
          trigger: p.trigger,
          steps: p.steps,
          isEnabled: p.isEnabled,
          source: p.source,
        }));
      },
    }),
    propose_playbook: tool({
      description: "Propone un procedimiento nuevo, o la nueva versión de uno existente (con su id).",
      inputSchema: z.object({
        summary: z.string().max(300),
        id: z.string().optional(),
        name: z.string(),
        trigger: z.string(),
        steps: z.string(),
      }),
      execute: async ({ summary, id, ...playbook }) => {
        log("propose_playbook", { summary, id, ...playbook });
        const parsed = playbookSchema.safeParse(playbook);
        if (!parsed.success) return { error: "Faltan datos o son muy largos." };
        proposals.push({ type: "playbook", summary, playbook: { id, ...parsed.data } });
        return { proposed: true };
      },
    }),
    find_chat: tool({
      description: "Busca chats de WhatsApp por nombre o número.",
      inputSchema: z.object({ query: z.string().min(2) }),
      execute: async ({ query }) => {
        log("find_chat", { query });
        const chats = await listChats({ queue: "all", q: query, take: 8 });
        return Promise.all(
          chats.map(async (c) => ({
            conversationId: c.id,
            name: c.name,
            phone: c.phone,
            mode: c.aiMode,
            paused: c.paused,
            escalation: c.escalation,
            lastMessage: c.lastMessage?.slice(0, 160),
            memory: await getMemory(c.phone),
          }))
        );
      },
    }),
    propose_chat_mode: tool({
      description:
        "Propone cambiar quién atiende un chat: AUTO (tú sola), COPILOT (borradores que Dayana envía) o MANUAL (solo Dayana). priority=true lo sube a «Tú atiendes».",
      inputSchema: z.object({
        conversationId: z.string(),
        mode: z.enum(["AUTO", "COPILOT", "MANUAL"]),
        priority: z.boolean().optional(),
        summary: z.string().max(200),
      }),
      execute: async (args) => {
        log("propose_chat_mode", args);
        const exists = await prisma.conversation.count({ where: { id: args.conversationId } });
        if (!exists) return { error: "No encontré ese chat. Usa find_chat." };
        proposals.push({ type: "chat_mode", ...args });
        return { proposed: true };
      },
    }),
    propose_memory: tool({
      description: "Propone reescribir lo que recuerdas de una persona (su ficha).",
      inputSchema: z.object({
        phone: z.string().describe("Número en dígitos, sin +."),
        conversationId: z.string().optional(),
        notes: z.string().max(1500),
        summary: z.string().max(200),
      }),
      execute: async (args) => {
        log("propose_memory", args);
        proposals.push({
          type: "memory",
          summary: args.summary,
          phone: args.phone.replace(/\D/g, ""),
          conversationId: args.conversationId ?? null,
          notes: args.notes,
        });
        return { proposed: true };
      },
    }),
    simulate_reply: tool({
      description:
        "Muestra qué contestarías tú (el asistente de WhatsApp) a un mensaje de una persona, con la configuración actual. No envía nada.",
      inputSchema: z.object({ message: z.string().min(1).max(1000) }),
      execute: async ({ message }) => {
        log("simulate_reply", { message });
        const draft = await draftAutoReply({
          config: await getWhatsAppAiConfig(),
          transcript: [{ direction: "INBOUND", body: message }],
          name: null,
        });
        return {
          action: draft.action,
          message: draft.message,
          reason: draft.reason,
          toolsUsed: draft.toolCalls.map((t) => t.tool),
        };
      },
    }),
  };

  const result = await generateText({
    model: google(modelId()),
    system: SYSTEM,
    messages: messages.slice(-30),
    tools,
    stopWhen: isStepCount(8),
  });

  return { text: result.text.trim(), proposals, steps };
};
