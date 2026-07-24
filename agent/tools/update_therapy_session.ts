import { defineTool } from "eve/tools";
import { z } from "zod";
import { updateTherapySession } from "@/lib/crm/therapy";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Edit a therapy session's scheduled time, meeting link, or duration without changing its completion status.",
  inputSchema: z.object({
    sessionId: z.string().min(1),
    scheduledAt: z.string().datetime().optional(),
    meetUrl: z.string().url().nullable().optional(),
    durationMinutes: z.number().int().min(1).optional(),
  }),
  async execute({ sessionId, scheduledAt, meetUrl, durationMinutes }, ctx) {
    requireWriteStaff(ctx);
    const session = await updateTherapySession(sessionId, {
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      meetUrl,
      durationMinutes,
    });
    await auditAgentWrite(ctx, {
      action: "UPDATE",
      entityType: "TherapySession",
      entityId: sessionId,
      changes: { scheduledAt, meetUrl, durationMinutes },
    });
    return {
      session: {
        id: session.id,
        scheduledAt: session.scheduledAt?.toISOString() ?? null,
        meetUrl: session.meetUrl,
        durationMinutes: session.durationMinutes,
      },
    };
  },
});
