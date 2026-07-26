import { defineTool } from "eve/tools";
import { z } from "zod";
import { listQuickMessageTemplates } from "@/lib/crm/messages";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description: "List the quick-message templates staff can send to a contact via WhatsApp.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const templates = await listQuickMessageTemplates();
    return {
      templates: templates.map((t) => ({ key: t.key, title: t.title, body: t.body })),
    };
  },
});
