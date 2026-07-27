import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getContactById } from "@/lib/crm/contacts";
import { isDryRun, isNotificationsEnabled } from "@/lib/notifications/config";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";
import {
  escapeHtml,
  varsToPlainParagraphs,
  wrapEmailHtml,
} from "@/lib/notifications/templates/email-layout";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

/** Escaped paragraphs, split on blank lines; single newlines stay as line breaks. */
const bodyToHtml = (body: string): string =>
  varsToPlainParagraphs(
    body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => escapeHtml(p).replace(/\n/g, "<br />"))
  );

export default defineTool({
  description:
    "Send one freeform email to a single contact, wrapped in the brand email layout. Use it for a one-off reply or follow-up; for standard wording prefer send_contact_template_email. It sends to ONE contact — there is no bulk or campaign sending — and it refuses contacts who opted out of email. The result includes a `dryRun` flag: when it is true nothing actually left the server, so tell the operator the send was only simulated instead of claiming it was delivered.",
  inputSchema: z
    .object({
      contactId: z.string().min(1),
      subject: z.string().trim().min(3).max(150),
      body: z
        .string()
        .trim()
        .min(10)
        .max(4000)
        .describe(
          "Texto plano. Separa párrafos con líneas en blanco; se formatea con la plantilla de marca."
        ),
      ctaLabel: z.string().trim().min(2).max(40).optional(),
      ctaUrl: z.string().url().optional(),
    })
    .refine((v) => (v.ctaLabel == null) === (v.ctaUrl == null), {
      message: "ctaLabel y ctaUrl deben ir juntos o ninguno.",
    }),
  approval: always(),
  async execute({ contactId, subject, body, ctaLabel, ctaUrl }, ctx) {
    requireWriteStaff(ctx);

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

    const html = wrapEmailHtml({
      preheader: body.slice(0, 120),
      eyebrow: "Dayana Beltrán PNL",
      title: subject,
      bodyHtml: bodyToHtml(body),
      ctaPrimary:
        ctaLabel && ctaUrl ? { label: ctaLabel, href: ctaUrl } : undefined,
    });

    const { delivery, result } = await dispatchAndRecord({
      contactId,
      channel: "EMAIL",
      subject,
      body,
      html,
      text: body,
    });

    await auditAgentWrite(ctx, {
      action: "SEND_EMAIL",
      entityType: "NotificationDelivery",
      entityId: delivery.id,
      changes: {
        contactId,
        subject,
        chars: body.length,
        status: result.status,
      },
    });

    await emitPlatformNotification({
      eventType: "AGENT_ACTION_EXECUTED",
      title: "El asistente envió un correo",
      body: `${contact.displayName ?? contact.firstName} — "${subject}" (${result.status})`,
      href: `/admin/contacts/${contactId}`,
      entityType: "NotificationDelivery",
      entityId: delivery.id,
      staff: "ALL",
    });

    return {
      deliveryId: delivery.id,
      status: result.status,
      recipient: result.recipient,
      dryRun: isDryRun(),
      note:
        result.status === "SKIPPED"
          ? "Se registró pero NO se envió — revisa la configuración."
          : undefined,
    };
  },
});
