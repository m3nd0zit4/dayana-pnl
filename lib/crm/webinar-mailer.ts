import { NotificationDeliveryStatus } from "@prisma/client";
import {
  ensureFreeWebinar,
  formatWebinarScheduleLabel,
  type FreeWebinarPublic,
} from "@/lib/crm/free-webinar";
import {
  claimRegistrationFlag,
  findPendingLinkRecipients,
  findPendingReminderRecipients,
  releaseRegistrationFlag,
  reminderFlag,
  type ReminderKind,
  type WebinarMailRecipient,
} from "@/lib/crm/webinar-registrations";
import { dispatchAndRecord } from "@/lib/notifications/dispatch";
import { resolveNotificationsEnabled } from "@/lib/notifications/platform/resolve";
import {
  webinarMeetLinkHtml,
  webinarMeetLinkSubject,
  webinarMeetLinkText,
  webinarReminderHtml,
  webinarReminderSubject,
  webinarReminderText,
} from "@/lib/notifications/templates/webinar-emails";

/**
 * Envío del enlace de la reunión y de los dos recordatorios.
 *
 * Patrón en los tres casos: reclamar el sello → enviar → soltarlo si el envío
 * no salió. Reclamar primero es lo que evita que dos ejecuciones solapadas
 * (el evento de Inngest y el cron) manden el mismo correo dos veces.
 */

export type WebinarMailResult = {
  sent: number;
  failed: number;
  /** `true` cuando no se tocó ninguna fila: notificaciones apagadas o sin datos. */
  skipped: boolean;
  reason?: string;
};

const noop = (reason: string): WebinarMailResult => ({
  sent: 0,
  failed: 0,
  skipped: true,
  reason,
});

const firstName = (r: WebinarMailRecipient): string =>
  r.contact.firstName?.trim() || "Hola";

type SendOne = {
  subject: string;
  html: string;
  text: string;
  /** Snapshot en texto plano que queda en `NotificationDelivery`. */
  body: string;
  templateKey: string;
};

const deliver = async (
  recipient: WebinarMailRecipient,
  flag: Parameters<typeof claimRegistrationFlag>[1],
  payload: SendOne
): Promise<"sent" | "failed"> => {
  const claimed = await claimRegistrationFlag(recipient.id, flag);
  if (!claimed) return "sent"; // otro proceso ya se quedó con este envío

  try {
    const { result } = await dispatchAndRecord({
      contactId: recipient.contactId,
      channel: "EMAIL",
      templateKey: payload.templateKey,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      body: payload.body,
      // Sin campaignId a propósito: esto es 1:1. Con él, Resend añadiría
      // List-Unsubscribe y Gmail lo archivaría en Promociones.
    });
    if (result.status === NotificationDeliveryStatus.SENT) return "sent";
  } catch (e) {
    console.error(
      "[webinar-mailer] dispatch",
      e instanceof Error ? e.message : e
    );
  }

  await releaseRegistrationFlag(recipient.id, flag);
  return "failed";
};

/**
 * Guarda global. Sin esto, con las notificaciones apagadas cada envío vuelve
 * SKIPPED, se suelta el sello, y el cron reintenta la lista entera cada diez
 * minutos para siempre.
 */
const notificationsOff = async (): Promise<boolean> =>
  !(await resolveNotificationsEnabled());

export const sendPendingWebinarLinkEmails =
  async (): Promise<WebinarMailResult> => {
    if (await notificationsOff()) return noop("notifications_disabled");

    const webinar = await ensureFreeWebinar();
    if (!webinar.meetUrl) return noop("no_meet_url");

    const recipients = await findPendingLinkRecipients(webinar.id);
    if (recipients.length === 0) return noop("no_pending_recipients");

    const scheduleLabel = formatWebinarScheduleLabel(webinar);
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const vars = {
        firstName: firstName(recipient),
        meetUrl: webinar.meetUrl,
        scheduleLabel,
      };
      const outcome = await deliver(recipient, "linkEmailSentAt", {
        templateKey: "webinar_meet_link",
        subject: webinarMeetLinkSubject(),
        html: webinarMeetLinkHtml(vars),
        text: webinarMeetLinkText(vars),
        body: webinarMeetLinkText(vars),
      });
      if (outcome === "sent") sent += 1;
      else failed += 1;
    }

    return { sent, failed, skipped: false };
  };

/**
 * Ventanas de los recordatorios. El sello por persona ya evita duplicados, así
 * que la ventana solo decide *cuándo* entra alguien a la cola:
 *
 * - 24 h: entre 2 h y 24 h antes. El suelo de 2 h existe para que quien se
 *   registra tres horas antes no reciba un «falta un día» absurdo; a esa
 *   persona la recoge el pase de 1 h.
 * - 1 h: dentro de la última hora, y solo si el webinar tiene hora real.
 *   Sin hora, `startsAt` guarda un ancla de mediodía y avisar «en una hora»
 *   sobre una hora inventada es peor que no avisar.
 */
const reminderWindowOpen = (
  webinar: FreeWebinarPublic,
  kind: ReminderKind,
  now: Date
): boolean => {
  if (!webinar.startsAt) return false;
  const msToStart = webinar.startsAt.getTime() - now.getTime();
  if (msToStart <= 0) return false;

  if (kind === "24h") {
    return msToStart > 2 * 60 * 60 * 1000 && msToStart <= 24 * 60 * 60 * 1000;
  }
  return webinar.startsAtHasTime && msToStart <= 60 * 60 * 1000;
};

export const sendPendingWebinarReminders = async (
  kind: ReminderKind,
  now: Date = new Date()
): Promise<WebinarMailResult> => {
  if (await notificationsOff()) return noop("notifications_disabled");

  const webinar = await ensureFreeWebinar();
  if (!webinar.isActive) return noop("inactive");
  if (!reminderWindowOpen(webinar, kind, now)) return noop("outside_window");

  const recipients = await findPendingReminderRecipients(webinar.id, kind);
  if (recipients.length === 0) return noop("no_pending_recipients");

  const scheduleLabel = formatWebinarScheduleLabel(webinar);
  const flag = reminderFlag(kind);
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const vars = {
      kind,
      firstName: firstName(recipient),
      meetUrl: webinar.meetUrl,
      scheduleLabel,
    };
    const outcome = await deliver(recipient, flag, {
      templateKey: `webinar_reminder_${kind}`,
      subject: webinarReminderSubject(vars),
      html: webinarReminderHtml(vars),
      text: webinarReminderText(vars),
      body: webinarReminderText(vars),
    });
    if (outcome === "sent") sent += 1;
    else failed += 1;
  }

  return { sent, failed, skipped: false };
};
