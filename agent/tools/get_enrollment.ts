import { defineTool } from "eve/tools";
import { z } from "zod";
import { getEnrollmentById } from "@/lib/crm/enrollments";

export default defineTool({
  description:
    "Get full detail for one enrollment by id: status, product, contact, payment history (status only, not amounts), and therapy sessions if it's a therapy product.",
  inputSchema: z.object({ enrollmentId: z.string().min(1) }),
  async execute({ enrollmentId }) {
    const e = await getEnrollmentById(enrollmentId);
    if (!e) return { found: false as const };

    return {
      found: true as const,
      enrollment: {
        id: e.id,
        status: e.status,
        productTitle: e.product.title,
        contactName: `${e.contact.firstName} ${e.contact.lastName ?? ""}`.trim(),
        contactPhone: e.contact.phoneE164,
        sessionsUsed: e.sessionsUsed,
        sessionsTotal: e.sessionsTotal,
        ref: { type: "enrollment" as const, id: e.id, href: `/admin/enrollments/${e.id}` },
        contactRef: { type: "contact" as const, id: e.contact.id, href: `/admin/contacts/${e.contact.id}` },
      },
      payments: e.payments.map((p) => ({ id: p.id, status: p.status, provider: p.provider })),
      therapySessions:
        e.therapyPackage?.sessions.map((s) => ({
          id: s.id,
          sessionNumber: s.sessionNumber,
          status: s.status,
          scheduledAt: s.scheduledAt?.toISOString() ?? null,
        })) ?? null,
    };
  },
});
