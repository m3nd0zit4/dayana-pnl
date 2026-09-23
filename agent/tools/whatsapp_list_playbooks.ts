import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { listPlaybooks, seedDefaultPlaybooks } from "@/lib/crm/whatsapp-agent/playbooks";

export default defineTool({
  description:
    "List the WhatsApp AI's playbooks (what to do in each situation: booking, prices, payments…), including the ones it proposed from Dayana's corrections (source=learned, isEnabled=false, waiting for approval).",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    await seedDefaultPlaybooks();
    return (await listPlaybooks()).map((p) => ({
      id: p.id,
      name: p.name,
      trigger: p.trigger,
      steps: p.steps,
      isEnabled: p.isEnabled,
      source: p.source,
    }));
  },
});
