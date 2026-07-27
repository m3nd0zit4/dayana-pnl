import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getContactById } from "@/lib/crm/contacts";
import { linkConversationToContact } from "@/lib/crm/conversations";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Link an inbox conversation to an existing CRM contact. Use it for Instagram and Messenger threads, where Meta gives an opaque id instead of a phone number, so the thread arrives unlinked. The link is permanent: the next time that person writes, their thread is recognised automatically. Confirm the identity with the operator before linking — a wrong link attaches a stranger's chat to a real customer's record.",
  inputSchema: z.object({
    conversationId: z.string().min(1),
    contactId: z.string().min(1),
  }),
  approval: always(),
  async execute({ conversationId, contactId }, ctx) {
    const staff = requireWriteStaff(ctx);

    const contact = await getContactById(contactId);
    if (!contact) throw new Error("Ese contacto no existe.");

    const linked = await linkConversationToContact(
      conversationId,
      contactId,
      staff.staffId
    );

    await auditAgentWrite(ctx, {
      action: "LINK_CONVERSATION",
      entityType: "Conversation",
      entityId: conversationId,
      changes: { contactId },
    });

    return {
      conversationId: linked.id,
      contactId,
      contactName: contact.displayName ?? contact.firstName,
    };
  },
});
