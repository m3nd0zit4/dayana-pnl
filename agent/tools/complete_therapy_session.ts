import { defineTool } from "eve/tools";
import { z } from "zod";
import { completeTherapySession } from "@/lib/crm/therapy";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description: "Mark one therapy session as completed. Reversible via uncomplete_therapy_session.",
  inputSchema: z.object({ sessionId: z.string().min(1) }),
  async execute({ sessionId }, ctx) {
    requireWriteStaff(ctx);
    const session = await completeTherapySession(sessionId);
    await auditAgentWrite(ctx, {
      action: "COMPLETE",
      entityType: "TherapySession",
      entityId: sessionId,
    });
    return {
      session: {
        id: session?.id,
        status: session?.status,
        usedSessions: session?.therapyPackage.usedSessions,
        totalSessions: session?.therapyPackage.totalSessions,
      },
    };
  },
});
