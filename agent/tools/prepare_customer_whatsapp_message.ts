import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getContactById } from "@/lib/crm/contacts";
import { buildTemplatedWhatsAppUrl } from "@/lib/crm/messages";
import { isQuickMessageTemplate } from "@/lib/crm/quick-message-templates";
import { requireWriteStaff, getCallerStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Prepare a WhatsApp message to a contact from a quick-message template (see list_message_templates). This does NOT send anything by itself — it returns a wa.me link that opens WhatsApp with the message pre-filled; the operator still has to review and press send themselves. Confirm the contact and template with the operator first.",
  inputSchema: z.object({
    contactId: z.string().min(1),
    templateKey: z.string().min(1),
    vars: z.record(z.string(), z.string()).optional().describe("Extra template placeholders beyond first_name/last_name"),
  }),
  approval: always(),
  async execute({ contactId, templateKey, vars }, ctx) {
    requireWriteStaff(ctx);
    if (!isQuickMessageTemplate(templateKey)) {
      throw new Error("Esa plantilla es de uso interno del sistema, no está disponible aquí.");
    }
    const contact = await getContactById(contactId);
    if (!contact) throw new Error("Contacto no encontrado.");

    const { staffId } = getCallerStaff(ctx);
    const url = await buildTemplatedWhatsAppUrl(
      contactId,
      templateKey,
      {
        first_name: contact.firstName,
        last_name: contact.lastName ?? "",
        ...vars,
      },
      staffId
    );

    return { whatsappUrl: url, note: "Ábrelo y confirma antes de enviar — no se envía automáticamente." };
  },
});
