import { defineTool } from "eve/tools";
import { z } from "zod";
import { listEnrollmentsAdmin } from "@/lib/crm/enrollments-list";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "List enrollments, optionally filtered by status (LEAD, PENDING_PAYMENT, ACTIVE, COMPLETED, CANCELLED, REFUNDED) or a text query on contact name/phone or product title.",
  inputSchema: z.object({
    status: z
      .enum(["LEAD", "PENDING_PAYMENT", "ACTIVE", "COMPLETED", "CANCELLED", "REFUNDED"])
      .optional(),
    q: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async execute({ status, q, limit }, ctx) {
    requireStaff(ctx);
    const rows = await listEnrollmentsAdmin({ status, q, limit });
    return {
      enrollments: rows.map((e) => ({
        id: e.id,
        status: e.status,
        contactName: `${e.contact.firstName} ${e.contact.lastName ?? ""}`.trim(),
        contactPhone: e.contact.phoneE164,
        productTitle: e.product.title,
        hasApprovedPayment: e.payments.length > 0,
        ref: { type: "enrollment" as const, id: e.id, href: `/admin/enrollments/${e.id}` },
      })),
    };
  },
});
