import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";
import { prisma } from "@/lib/db";
import { resumeAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { CHAT_INSTRUCTIONS_MAX, setChatInstructions } from "@/lib/crm/whatsapp-agent/chat-instructions";
import { setMemory } from "@/lib/crm/whatsapp-agent/memory";

export default defineTool({
  description:
    "Change who handles one WhatsApp chat — AUTO (the AI answers alone), COPILOT (the AI drafts, Dayana sends), MANUAL (only Dayana) — mark it as priority, resume the AI after a hand-off, rewrite what the AI remembers about that person (memory), or give the AI an instruction for THIS chat only (instructions: how to answer this person, what to offer or not offer, what to tell them next time they write; empty string removes it). Instructions are for this one person; a rule for everyone goes to whatsapp_save_playbook. After setting instructions, prove them with whatsapp_simulate_reply using this conversationId. Find the chat first with whatsapp_find_chat.",
  inputSchema: z.object({
    conversationId: z.string(),
    mode: z.enum(["AUTO", "COPILOT", "MANUAL"]).optional(),
    priority: z.boolean().optional(),
    resume: z
      .boolean()
      .optional()
      .describe("Quita la pausa o escalada para que la IA vuelva a contestar."),
    memory: z.string().max(1500).optional().describe("Nueva ficha completa de la persona."),
    instructions: z
      .string()
      .max(CHAT_INSTRUCTIONS_MAX)
      .optional()
      .describe("Instrucción de Dayana solo para este chat, en sus palabras. Texto vacío la quita."),
  }),
  approval: always(),
  async execute({ conversationId, mode, priority, resume, memory, instructions }, ctx) {
    requireWriteStaff(ctx);
    const chat = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channel: true, externalThreadId: true, contactId: true },
    });
    if (!chat || chat.channel !== "WHATSAPP") throw new Error("Ese chat de WhatsApp no existe.");
    if (mode || priority !== undefined) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          // `aiModeOverride` es lo que lee el enrutador (como en el chat); `aiMode` solo se muestra.
          ...(mode ? { aiMode: mode, aiModeOverride: mode } : {}),
          ...(priority === undefined ? {} : { priorityAt: priority ? new Date() : null }),
          // Elegir un modo o marcarlo favorito apaga «La IA responde siempre» (como en el chat).
          ...(mode || priority ? { aiAlwaysAt: null, aiAlwaysById: null } : {}),
        },
      });
    }
    // Una escalada clínica, de pago o urgente no se levanta desde aquí: espera a «Listo».
    const resumed = resume || (mode && mode !== "MANUAL") ? await resumeAutoReply(conversationId) : true;
    if (memory !== undefined) await setMemory(chat.externalThreadId, memory, chat.contactId);
    const chatInstructions = instructions === undefined ? undefined : await setChatInstructions(conversationId, instructions);
    await auditAgentWrite(ctx, {
      action: "WHATSAPP_CHAT_UPDATED",
      entityType: "WhatsAppChat",
      entityId: conversationId,
      changes: { mode, priority, resume, memory: memory !== undefined, instructions: chatInstructions, stillPaused: !resumed },
    });
    return {
      ok: true,
      ...(chatInstructions === undefined ? {} : { instructions: chatInstructions ?? "(quitadas)" }),
      ...(resumed
        ? {}
        : {
            stillPaused:
              "The AI stays paused: it is a clinical, payment or urgent hand-off. Dayana must open the chat and press «Listo».",
          }),
      link: `/admin/whatsapp?conversation=${conversationId}`,
    };
  },
});
