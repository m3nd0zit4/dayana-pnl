import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { draftAutoReply } from "@/lib/crm/whatsapp-autoreply";
import type { TranscriptLine } from "@/lib/crm/whatsapp-agent/brain";
import { getChatInstructions } from "@/lib/crm/whatsapp-agent/chat-instructions";
import { getMemory } from "@/lib/crm/whatsapp-agent/memory";

/** How much of a real chat the simulation reads. */
const CHAT_LINES = 30;

export default defineTool({
  description:
    "Show exactly what the WhatsApp AI would answer, without sending anything or really booking. Two ways: (1) only `messages` — a made-up person with no history, to test a general rule; (2) with `conversationId` — inside that real chat, with its recent history, what the AI remembers of the person and Dayana's instruction for that chat; `messages` are then appended as if the person had just written them (leave them out to see what it would answer to the last message). Use it when Dayana asks what it would reply, and always after changing a rule or a chat's instructions, to prove the change.",
  inputSchema: z.object({
    messages: z
      .array(z.string().min(1).max(1000))
      .max(6)
      .optional()
      .describe("Mensajes seguidos de la persona."),
    conversationId: z.string().optional().describe("Simular dentro de este chat real (whatsapp_find_chat)."),
  }),
  async execute({ messages, conversationId }, ctx) {
    requireStaff(ctx);
    const extra: TranscriptLine[] = (messages ?? []).map((body) => ({ direction: "INBOUND" as const, body, sentAt: new Date() }));

    let transcript: TranscriptLine[] = extra;
    let name: string | null = null;
    let memory: string | null = null;
    let chatInstructions: string | null = null;
    if (conversationId) {
      const chat = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { channel: true, externalThreadId: true, participantName: true },
      });
      if (!chat || chat.channel !== "WHATSAPP") throw new Error("Ese chat de WhatsApp no existe.");
      const rows = await prisma.conversationMessage.findMany({
        where: { conversationId, status: { not: "FAILED" } },
        orderBy: { sentAt: "desc" },
        take: CHAT_LINES,
        select: { direction: true, body: true, sentAt: true, isAutoReply: true, source: true, clientKey: true },
      });
      transcript = [
        ...rows.reverse().map((m) => ({
          direction: m.direction === "INBOUND" ? ("INBOUND" as const) : ("OUTBOUND" as const),
          body: m.body,
          sentAt: m.sentAt,
          isAutoReply: m.isAutoReply,
          source: m.source,
          clientKey: m.clientKey,
        })),
        ...extra,
      ];
      name = chat.participantName ?? null;
      memory = await getMemory(chat.externalThreadId);
      chatInstructions = await getChatInstructions(conversationId);
    }
    if (transcript.length === 0 || transcript.at(-1)?.direction !== "INBOUND") {
      throw new Error("No hay un mensaje de la persona al que responder: pasa `messages`.");
    }

    const draft = await draftAutoReply({
      config: await getWhatsAppAiConfig(),
      transcript,
      name,
      memory,
      chatInstructions,
    });
    return {
      wouldDo: draft.action === "reply" ? "responder" : "pasarle el chat a Dayana (sin contestar)",
      message: draft.message || null,
      reason: draft.reason || null,
      toolsUsed: draft.toolCalls.map((t) => t.tool),
      ...(conversationId ? { usedChatInstructions: chatInstructions } : {}),
    };
  },
});
