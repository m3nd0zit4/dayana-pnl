import { defineTool } from "eve/tools";
import { z } from "zod";
import { markTherapySessionNoShow } from "@/lib/crm/therapy";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description: "Mark a scheduled therapy session as a no-show.",
  inputSchema: z.object({ sessionId: z.string().min(1) }),
  async execute({ sessionId }, ctx) {
    requireWriteStaff(ctx);
    const session = await markTherapySessionNoShow(sessionId);
    await auditAgentWrite(ctx, {
      action: "NO_SHOW",
      entityType: "TherapySession",
      entityId: sessionId,
    });
    return { session: { id: session.id, status: session.status } };
  },
});
