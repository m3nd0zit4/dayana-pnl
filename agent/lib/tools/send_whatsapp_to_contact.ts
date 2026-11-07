import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { requireWriteStaff, getCallerStaff } from "@/agent/lib/guard";
import { sendWhatsAppToContact } from "@/lib/crm/whatsapp-outbound";

export default defineTool({
  description:
    "Send a real WhatsApp message to one CRM contact (it goes out from Dayana's WhatsApp and appears in the chat). Within 24 h of the person's last message it goes as free text; otherwise the approved template for templateKey is used (paid per message) or it is not sent. Use {{nombre}} in the text for the first name. Confirm the contact and the text with the operator first.",
  inputSchema: z.object({
    contactId: z.string().min(1),
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
  async execute({ contactId, text, templateKey, vars }, ctx) {
    requireWriteStaff(ctx);
    const { staffId } = getCallerStaff(ctx);
    const result = await sendWhatsAppToContact({
      contactId,
      text,
      templateKey: templateKey ?? null,
      vars: templateKey === "retomar_conversacion" ? { mensaje: text, ...vars } : vars,
      source: "crm:asistente",
      staffId,
    });
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
