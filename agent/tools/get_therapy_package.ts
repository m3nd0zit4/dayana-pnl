import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTherapyPackageByEnrollment } from "@/lib/crm/therapy";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Get a therapy package (and all its sessions) by enrollment id — use to check progress, find gaps in scheduling, or get a session id before scheduling/completing it.",
  inputSchema: z.object({ enrollmentId: z.string().min(1) }),
  async execute({ enrollmentId }, ctx) {
    requireStaff(ctx);
    const pkg = await getTherapyPackageByEnrollment(enrollmentId);
    if (!pkg) return { found: false as const };

    return {
      found: true as const,
      package: {
        id: pkg.id,
        totalSessions: pkg.totalSessions,
        usedSessions: pkg.usedSessions,
        meetDefaultUrl: pkg.meetDefaultUrl,
        contactName: `${pkg.enrollment.contact.firstName} ${pkg.enrollment.contact.lastName ?? ""}`.trim(),
        productTitle: pkg.enrollment.product.title,
      },
      sessions: pkg.sessions.map((s) => ({
        id: s.id,
        sessionNumber: s.sessionNumber,
        status: s.status,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
        meetUrl: s.meetUrl,
      })),
    };
  },
});
