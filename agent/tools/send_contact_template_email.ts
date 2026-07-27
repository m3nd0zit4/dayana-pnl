import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getContactById } from "@/lib/crm/contacts";
import { getMessageTemplate } from "@/lib/crm/messages";
import {
  isAgentSendableTemplate,
  missingTemplateVariables,
} from "@/lib/crm/quick-message-templates";
import { renderQuickMessage } from "@/lib/crm/render-message";
import { isDryRun, isNotificationsEnabled, siteUrl } from "@/lib/notifications/config";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";
import { contactVars } from "@/lib/notifications/variables";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Send one quick-message template (see list_message_templates) to a single contact by email. Subject and layout come from the template itself — you only pick the template and any extra variables. System templates (payment receipts, cron reminders) are rejected, it sends to ONE contact at a time with no bulk or campaign mode, and it refuses contacts who opted out of email. The result includes a `dryRun` flag: when it is true nothing actually left the server, so tell the operator the send was only simulated instead of claiming it was delivered.",
  inputSchema: z.object({
    contactId: z.string().min(1),
    templateKey: z.string().min(1).describe("Una clave de list_message_templates."),
    vars: z
      .record(z.string(), z.string())
      .optional()
      .describe("Variables extra además de first_name/last_name/display_name."),
  }),
  approval: always(),
  async execute({ contactId, templateKey, vars }, ctx) {
    requireWriteStaff(ctx);

    // Las transaccionales las envía el flujo que puede rellenarlas. Un aviso de
    // restablecimiento de contraseña que nadie pidió tiene forma de phishing, y
    // un "tu mensualidad venció" equivocado es una llamada a soporte.
    if (!isAgentSendableTemplate(templateKey)) {
      throw new Error(
        "Esa plantilla es transaccional: la envía el sistema cuando corresponde, no yo. " +
          "Si necesitas decirle algo parecido, escríbelo con send_contact_email."
      );
    }

    const template = await getMessageTemplate(templateKey);
    if (!template) throw new Error("Plantilla no encontrada.");

    const contact = await getContactById(contactId);
    if (!contact) throw new Error("Contacto no encontrado.");
    if (!contact.email) throw new Error("Ese contacto no tiene correo registrado.");
    // Dispatch would silently return SKIPPED here; failing loudly gives the
    // model a reason it can relay instead of reporting a non-send as success.
    if (!contact.notifyEmail) {
      throw new Error(
        "Ese contacto desactivó las notificaciones por correo. No puedo escribirle."
      );
    }
    if (!isNotificationsEnabled()) {
      throw new Error(
        "Los envíos están desactivados (NOTIFICATIONS_ENABLED). Actívalo en /admin/ajustes/integraciones."
      );
    }

    // `site_url` backs the default CTA the campaign layout renders when the
    // template carries no workshop link — without it the email build fails.
    const mergedVars = { ...contactVars(contact), site_url: siteUrl(), ...vars };

    // renderQuickMessage solo sustituye las variables que recibe: cualquiera que
    // falte se entrega tal cual, así que el cliente vería «{{reset_url}}» en su
    // correo. Se comprueba antes de enviar, no después.
    const missing = missingTemplateVariables(template.body, mergedVars);
    if (missing.length > 0) {
      throw new Error(
        `A la plantilla «${template.title}» le faltan datos: ${missing.join(", ")}. ` +
          "Pásalos en `vars` o escribe el correo con send_contact_email."
      );
    }

    const body = renderQuickMessage(template.body, mergedVars);

    // No `subject`/`html`: dispatch derives both from the template title via
    // campaignEmailSubject/campaignEmailHtml. That's the whole point of this
    // tool existing separately from send_contact_email.
    const { delivery, result } = await dispatchAndRecord({
      contactId,
      channel: "EMAIL",
      templateKey,
      body,
      vars: mergedVars,
    });

    await auditAgentWrite(ctx, {
      action: "SEND_EMAIL",
      entityType: "NotificationDelivery",
      entityId: delivery.id,
      changes: {
        contactId,
        templateKey,
        chars: body.length,
        status: result.status,
      },
    });

    await emitPlatformNotification({
      eventType: "AGENT_ACTION_EXECUTED",
      title: "El asistente envió un correo con plantilla",
      body: `${contact.displayName ?? contact.firstName} — ${template.title} (${result.status})`,
      href: `/admin/contacts/${contactId}`,
      entityType: "NotificationDelivery",
      entityId: delivery.id,
      staff: "ALL",
    });

    return {
      deliveryId: delivery.id,
      status: result.status,
      recipient: result.recipient,
      templateKey,
      dryRun: isDryRun(),
      note:
        result.status === "SKIPPED"
          ? "Se registró pero NO se envió — revisa la configuración."
          : undefined,
    };
  },
});
