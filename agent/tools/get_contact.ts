import { defineTool } from "eve/tools";
import { z } from "zod";
import { getContactById } from "@/lib/crm/contacts";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Get full detail for one contact by id: profile, and their enrollments with products, payment status, and therapy package if any.",
  inputSchema: z.object({ contactId: z.string().min(1) }),
  async execute({ contactId }, ctx) {
    requireStaff(ctx);
    const contact = await getContactById(contactId);
    if (!contact) return { found: false as const };

    return {
      found: true as const,
      contact: {
        id: contact.id,
        name: contact.displayName ?? `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
        phone: contact.phoneE164,
        email: contact.email,
        countryIso: contact.countryIso,
        notes: contact.notes,
        ref: { type: "contact" as const, id: contact.id, href: `/admin/contacts/${contact.id}` },
      },
      enrollments: contact.enrollments.map((e) => ({
        id: e.id,
        status: e.status,
        productTitle: e.product.title,
        hasApprovedPayment: e.payments.some((p) => p.status === "APPROVED"),
        hasTherapyPackage: e.therapyPackage != null,
        ref: { type: "enrollment" as const, id: e.id, href: `/admin/enrollments/${e.id}` },
      })),
    };
  },
});
