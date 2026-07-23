import { defineTool } from "eve/tools";
import { z } from "zod";
import { uncompleteTherapySession } from "@/lib/crm/therapy";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description: "Undo a therapy session completion — reverts the used-session count.",
  inputSchema: z.object({ sessionId: z.string().min(1) }),
  async execute({ sessionId }, ctx) {
    requireWriteStaff(ctx);
    const session = await uncompleteTherapySession(sessionId);
    await auditAgentWrite(ctx, {
      action: "UNCOMPLETE",
      entityType: "TherapySession",
      entityId: sessionId,
    });
    return {
      session: {
        id: session?.id,
        status: session?.status,
        usedSessions: session?.therapyPackage.usedSessions,
      },
    };
  },
});
