import { prisma } from "@/lib/db";
import { sendEmail } from "../channels/email";
import { isNotificationsEnabled, siteUrl } from "../config";
import {
  escapeHtml,
  wrapEmailHtml,
} from "../templates/email-layout";
import { NOTIFICATION_CATALOG } from "./catalog";

const paragraphsToHtml = (body: string): string =>
  body
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(
      (chunk) =>
        `<p style="margin:0 0 14px;">${escapeHtml(chunk).replace(/\n/g, "<br />")}</p>`
    )
    .join("");

/** Convierte un `href` interno en una URL absoluta para el correo. */
const absoluteHref = (href: string | null): string | undefined => {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  return `${siteUrl().replace(/\/$/, "")}${href.startsWith("/") ? "" : "/"}${href}`;
};

/**
 * Reparte por correo una notificación ya creada.
 *
 * Idempotente: solo toma destinatarios con `emailedAt` nulo y lo estampa al
 * terminar, así un reintento no vuelve a enviar. Registra cada intento en
 * `NotificationDelivery` — que ahora acepta `staffUserId` sin contacto, y por
 * eso los avisos al equipo ya no tienen que saltarse la tubería.
 */
export const deliverNotificationEmails = async (notificationId: string) => {
  if (!isNotificationsEnabled()) return { sent: 0, skipped: 0 };

  const notification = await prisma.platformNotification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      eventType: true,
      title: true,
      body: true,
      href: true,
      recipients: {
        where: { emailedAt: null },
        select: {
          id: true,
          staffUserId: true,
          contactId: true,
          staffUser: {
            select: { email: true, displayName: true, notifyEmail: true },
          },
          contact: {
            select: { email: true, firstName: true, notifyEmail: true },
          },
        },
      },
    },
  });
  if (!notification || notification.recipients.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const entry = NOTIFICATION_CATALOG[notification.eventType];

  // Preferencias por evento del staff, en una sola consulta.
  const staffIds = notification.recipients
    .map((recipient) => recipient.staffUserId)
    .filter((id): id is string => Boolean(id));
  const prefRows = staffIds.length
    ? await prisma.staffNotificationPreference.findMany({
        where: {
          staffUserId: { in: staffIds },
          eventType: notification.eventType,
        },
        select: { staffUserId: true, email: true },
      })
    : [];
  const prefByStaff = new Map(
    prefRows.map((row) => [row.staffUserId, row.email])
  );

  const html = wrapEmailHtml({
    preheader: notification.body ?? notification.title,
    eyebrow: entry.group,
    title: notification.title,
    bodyHtml: notification.body
      ? paragraphsToHtml(notification.body)
      : `<p style="margin:0 0 14px;">${escapeHtml(notification.title)}</p>`,
    ctaPrimary: absoluteHref(notification.href)
      ? { label: "Abrir en el panel", href: absoluteHref(notification.href)! }
      : undefined,
  });
  const text = [notification.title, notification.body ?? ""]
    .filter(Boolean)
    .join("\n\n");

  let sent = 0;
  let skipped = 0;

  for (const recipient of notification.recipients) {
    const isStaff = Boolean(recipient.staffUserId);
    const to = isStaff
      ? recipient.staffUser?.email
      : recipient.contact?.email;

    // El interruptor maestro se combina con AND sobre la preferencia por evento.
    const wants = isStaff
      ? (recipient.staffUser?.notifyEmail ?? false) &&
        (prefByStaff.get(recipient.staffUserId!) ?? entry.defaultEmail)
      : (recipient.contact?.notifyEmail ?? false) && entry.defaultEmail;

    if (!to || !wants) {
      // Se estampa igual: no queremos reevaluarlo en cada pasada.
      await prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: { emailedAt: new Date() },
      });
      skipped += 1;
      continue;
    }

    let status: "SENT" | "FAILED" = "SENT";
    let providerId: string | null = null;
    let errorMessage: string | null = null;

    try {
      const result = await sendEmail({
        to,
        subject: notification.title,
        html,
        text,
      });
      providerId = result.messageId
        ? `${result.providerId}:${result.messageId}`
        : result.providerId;
      sent += 1;
    } catch (e) {
      status = "FAILED";
      errorMessage = e instanceof Error ? e.message : String(e);
    }

    await prisma.$transaction([
      prisma.notificationDelivery.create({
        data: {
          contactId: recipient.contactId,
          staffUserId: recipient.staffUserId,
          platformNotificationId: notification.id,
          channel: "EMAIL",
          status,
          templateKey: notification.eventType,
          subject: notification.title,
          bodySnapshot: text,
          recipient: to,
          providerId,
          errorMessage,
          sentAt: status === "SENT" ? new Date() : null,
        },
      }),
      prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: { emailedAt: new Date() },
      }),
    ]);
  }

  return { sent, skipped };
};
