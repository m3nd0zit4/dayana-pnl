import { defineTool } from "eve/tools";
import { z } from "zod";
import { searchContactsLight } from "@/lib/crm/contacts";

export default defineTool({
  description:
    "Search contacts by name, phone, or email. Read-only, fast — use this first when the operator mentions a customer by name/phone.",
  inputSchema: z.object({
    q: z.string().min(1).describe("Free-text query: name, phone digits, or email"),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async execute({ q, limit }) {
    const rows = await searchContactsLight({ q, limit });
    return {
      contacts: rows.map((c) => ({
        id: c.id,
        name: c.displayName ?? `${c.firstName} ${c.lastName ?? ""}`.trim(),
        phone: c.phoneE164,
        email: c.email,
        ref: { type: "contact" as const, id: c.id, href: `/admin/contacts/${c.id}` },
      })),
    };
  },
});
