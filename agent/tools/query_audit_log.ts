import { defineTool } from "eve/tools";
import { z } from "zod";
import { listAuditLogs } from "@/lib/crm/audit";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Read recent audit log entries — who changed what. Filter by entity type (e.g. TherapySession, Contact) or action (e.g. AGENT_COMPLETE).",
  inputSchema: z.object({
    entityType: z.string().optional(),
    action: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async execute({ entityType, action, limit }, ctx) {
    requireStaff(ctx);
    const logs = await listAuditLogs({ entityType, action, limit });
    return {
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        staffName: l.staffUser?.displayName ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  },
});
