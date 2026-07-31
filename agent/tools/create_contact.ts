import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { upsertContactByPhone } from "@/lib/crm/contacts";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Create a new contact (or update the matching one if the phone/email already exists). Only the phone number is required — name is optional. Confirm the phone number with the operator before calling this; if they don't have a name yet, don't block on it — offer to create the contact without one (it'll show by its phone number until a name is added) and suggest adding a name once they know it.",
  inputSchema: z.object({
    phone: z.string().min(4).describe("Phone number, any format — will be normalized"),
    phoneCountry: z.string().length(2).optional().describe("ISO country code for parsing, e.g. CO"),
    firstName: z.string().min(1).optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    notes: z.string().optional(),
  }),
  approval: always(),
  async execute({ phone, phoneCountry, firstName, lastName, email, notes }, ctx) {
    requireWriteStaff(ctx);
    const { contact, created } = await upsertContactByPhone({
      phone,
      phoneCountry,
      firstName,
      lastName,
      email,
      notes,
      source: "OTHER",
      sourceDetail: "agent",
    });
    await auditAgentWrite(ctx, {
      action: created ? "CREATE" : "UPDATE",
      entityType: "Contact",
      entityId: contact.id,
      changes: { phone: contact.phoneE164, firstName: contact.firstName },
    });
    return {
      created,
      contact: {
        id: contact.id,
        displayName: contact.displayName,
        phoneE164: contact.phoneE164,
        email: contact.email,
      },
    };
  },
});
