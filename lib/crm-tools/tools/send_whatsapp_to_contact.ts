import { defineTool } from "@/lib/crm-tools/define-tool";
import { always } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { requireWriteStaff, getCallerStaff } from "@/lib/crm-tools/guard";
import { sendWhatsAppToContact, sendWhatsAppToConversation } from "@/lib/crm/whatsapp-outbound";

export default defineTool({
  description:
    "Send a real WhatsApp message to one person (it goes out from Dayana's WhatsApp and appears in the chat): by CRM contact (contactId) or by WhatsApp chat (conversationId from whatsapp_find_chat — use it for chats that have no contact). Exactly one of the two. Within 24 h of the person's last message it goes as free text; otherwise the approved template for templateKey is used (paid per message) or it is not sent. Use {{nombre}} in the text for the first name. Confirm the contact and the text with the operator first.",
  inputSchema: z.object({
    contactId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional().describe("El chat de WhatsApp (whatsapp_find_chat), para quien no es contacto del CRM."),
    text: z.string().trim().min(1).max(4000),
    templateKey: z
      .string()
      .optional()
      .describe(
        "Plantilla para cuando pasaron las 24 h: evento_gratis_invitacion, evento_gratis_recordatorio, evento_grabacion, enlace_de_pago, taller_invitacion, taller_recordatorio, seguimiento_diagnostico, retomar_conversacion."
      ),
    vars: z.record(z.string(), z.string()).optional().describe("Valores de la plantilla: evento, fecha, enlace, paquete, mensaje…"),
  }),
  approval: always(),
  async execute({ contactId, conversationId, text, templateKey, vars }, ctx) {
    requireWriteStaff(ctx);
    const { staffId } = getCallerStaff(ctx);
    if (Boolean(contactId) === Boolean(conversationId)) {
      return { sent: false, reason: "Indica contactId o conversationId (uno de los dos)." };
    }
    const common = {
      text,
      templateKey: templateKey ?? null,
      vars: templateKey === "retomar_conversacion" ? { mensaje: text, ...vars } : vars,
      source: "crm:asistente",
      staffId,
    };
    const result = conversationId
      ? await sendWhatsAppToConversation({ conversationId, ...common })
      : await sendWhatsAppToContact({ contactId: contactId!, ...common });
    return result.status === "sent"
      ? { sent: true, mode: result.mode, link: `/admin/whatsapp?conversation=${result.conversationId}` }
      : result.status === "skipped"
        ? {
            sent: false,
            reason:
              result.reason === "needs_template"
                ? "Pasaron más de 24 h y no hay plantilla aprobada para esto (WhatsApp → Plantillas)."
                : result.reason === "no_phone"
                  ? "No tiene número de WhatsApp válido."
                  : "Pidió no recibir mensajes por WhatsApp.",
          }
        : { sent: false, reason: result.error };
  },
});
