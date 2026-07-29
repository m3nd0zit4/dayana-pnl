import { sendEmail } from "./channels/email";
import { emailProviderId, isNotificationsEnabled, siteUrl } from "./config";
import { escapeHtml, varsToPlainParagraphs, wrapEmailHtml } from "./templates/email-layout";

/**
 * Staff-directed sends (recipient is the owner, not a Contact) live here,
 * parallel to lib/notifications/dispatch.ts's dispatchAndRecord — that
 * pipeline's NotificationDelivery bookkeeping is FK'd to Contact, which
 * doesn't fit a message addressed to staff.
 */
export const notifyStaffOfNewComment = async (input: {
  classTitle: string;
  contactName: string;
  body: string;
}): Promise<void> => {
  if (!isNotificationsEnabled()) return;

  // El buzón de avisos del equipo manda sobre STAFF_OWNER_EMAIL: esa variable
  // suele apuntar a la dirección con la que se entra al panel, que no siempre
  // es un buzón capaz de recibir. Configurable en /admin/ajustes/notificaciones.
  const { getNotificationSiteConfig } = await import("./platform/site-config");
  const to =
    (await getNotificationSiteConfig()).staffAlertInbox ??
    process.env.STAFF_OWNER_EMAIL?.trim();
  if (!to || !emailProviderId()) return;

  const title = "Nuevo comentario en el curso";
  const html = wrapEmailHtml({
    eyebrow: "Portal del curso",
    title,
    bodyHtml: varsToPlainParagraphs([
      `<strong>${escapeHtml(input.contactName)}</strong> comentó en «${escapeHtml(input.classTitle)}»:`,
      escapeHtml(input.body),
    ]),
    ctaPrimary: { label: "Ir al CRM", href: `${siteUrl()}/admin/curso/modulos` },
  });
  const text = `${input.contactName} comentó en "${input.classTitle}":\n\n${input.body}`;

  await sendEmail({ to, subject: title, html, text });
};
