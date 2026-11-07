import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { draftAutoReply } from "@/lib/crm/whatsapp-autoreply";

export default defineTool({
  description:
    "Show exactly what the WhatsApp AI would answer to a client's messages with the current configuration, without sending anything or really booking. Use it when Dayana asks what it would reply to something, or to check a rule after changing it.",
  inputSchema: z.object({
    messages: z
      .array(z.string().min(1).max(1000))
      .min(1)
      .max(6)
      .describe("Mensajes seguidos de la persona."),
  }),
  async execute({ messages }, ctx) {
    requireStaff(ctx);
    const draft = await draftAutoReply({
      config: await getWhatsAppAiConfig(),
      transcript: messages.map((body) => ({ direction: "INBOUND" as const, body })),
      name: null,
    });
    return {
      wouldDo: draft.action === "reply" ? "responder" : "pasarle el chat a Dayana (sin contestar)",
      message: draft.message || null,
      reason: draft.reason || null,
      toolsUsed: draft.toolCalls.map((t) => t.tool),
    };
  },
});
