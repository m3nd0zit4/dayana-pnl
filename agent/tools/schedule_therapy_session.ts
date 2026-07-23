import { defineTool } from "eve/tools";
import { z } from "zod";
import { scheduleTherapySession } from "@/lib/crm/therapy";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Schedule a specific session slot (by therapyPackageId + sessionNumber, from get_therapy_package) to a date/time.",
  inputSchema: z.object({
    therapyPackageId: z.string().min(1),
    sessionNumber: z.number().int().min(1),
    scheduledAt: z.string().datetime().describe("ISO 8601 datetime"),
    meetUrl: z.string().url().optional(),
    durationMinutes: z.number().int().min(1).optional(),
  }),
  async execute({ therapyPackageId, sessionNumber, scheduledAt, meetUrl, durationMinutes }, ctx) {
    requireWriteStaff(ctx);
    const session = await scheduleTherapySession({
      therapyPackageId,
      sessionNumber,
      scheduledAt: new Date(scheduledAt),
      meetUrl,
      durationMinutes,
    });
    await auditAgentWrite(ctx, {
      action: "SCHEDULE",
      entityType: "TherapySession",
      entityId: session.id,
      changes: { scheduledAt },
    });
    return {
      session: {
        id: session.id,
        status: session.status,
        scheduledAt: session.scheduledAt?.toISOString() ?? null,
      },
    };
  },
});
