import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";

export default defineTool({
  description:
    "Read the WhatsApp AI's full configuration: identity, who it answers, schedule, limits, booking rules (services and durations, hours, buffer, notice, Meet), instructions, style guide, escalation message and default chat mode. Read it before proposing any change.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    return {
      enabled: await isWhatsAppAutoReplyEnabled(),
      config: await getWhatsAppAiConfig(),
    };
  },
});
