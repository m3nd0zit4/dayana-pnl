import { sendEmail } from "./channels/email";
import { emailFrom } from "./config";
import {
  leadConfirmationHtml,
  leadConfirmationSubject,
  leadConfirmationText,
  leadNotificationHtml,
  leadNotificationSubject,
  leadNotificationText,
  webinarConfirmationHtml,
  webinarConfirmationSubject,
  webinarConfirmationText,
  type LeadEmailInput,
  type WebinarLeadEmailInput,
} from "./templates/lead-notification";

/** Where the "new contact" notification lands (Dayana's inbox). */
const leadInbox = (): string =>
  process.env.NOTIFICATIONS_LEAD_TO?.trim() ||
  process.env.NOTIFICATIONS_EMAIL_TO?.trim() ||
  emailFrom().email;

/**
 * Fire the transactional emails for a new web lead. Best-effort: each send is
 * isolated so a failure never blocks the lead from being stored. `sendEmail`
 * already no-ops (logs) under NOTIFICATIONS_DRY_RUN.
 */
export async function notifyNewLead(input: LeadEmailInput): Promise<void> {
  // 1 · internal notification to Dayana
  try {
    await sendEmail({
      to: leadInbox(),
      subject: leadNotificationSubject(input),
      html: leadNotificationHtml(input),
      text: leadNotificationText(input),
    });
  } catch (e) {
    console.error("[lead-notify] admin", e instanceof Error ? e.message : e);
  }

  // 2 · confirmation to the person who wrote in (only if they left an email)
  if (input.email && input.email.includes("@")) {
    try {
      await sendEmail({
        to: input.email,
        subject: leadConfirmationSubject(),
        html: leadConfirmationHtml(input),
        text: leadConfirmationText(input),
      });
    } catch (e) {
      console.error("[lead-notify] confirm", e instanceof Error ? e.message : e);
    }
  }
}

export type WebinarNotifyResult = {
  /**
   * Salió el correo de confirmación CON el enlace de Meet dentro. Solo
   * entonces se puede sellar `linkEmailSentAt`: sellar antes, y tragarse el
   * fallo, dejaba a la persona sin enlace y fuera de la cola del fan-out.
   */
  confirmationSent: boolean;
};

/**
 * Webinar gratuito: notify Dayana + send a dedicated confirmation (or
 * "already registered") email to the attendee. Does not send the generic
 * lead-confirmation copy.
 *
 * `send` se inyecta solo en los tests (sin `mock.module`, que sustituiría el
 * módulo para todo el proceso).
 */
export async function notifyWebinarRegistration(
  input: WebinarLeadEmailInput,
  send: typeof sendEmail = sendEmail
): Promise<WebinarNotifyResult> {
  const adminMessage = input.alreadyRegistered
    ? "Ya estaba inscrita en este evento (re-registro)."
    : input.message;
  try {
    await send({
      to: leadInbox(),
      subject: input.alreadyRegistered
        ? `Re-registro webinar · ${[input.firstName, input.lastName].filter(Boolean).join(" ")}`
        : `Nuevo registro webinar · ${[input.firstName, input.lastName].filter(Boolean).join(" ")}`,
      html: leadNotificationHtml({
        ...input,
        interest: input.interest ?? "Webinar gratuito",
        message: adminMessage,
      }),
      text: leadNotificationText({
        ...input,
        interest: input.interest ?? "Webinar gratuito",
        message: adminMessage,
      }),
    });
  } catch (e) {
    console.error(
      "[lead-notify] webinar admin",
      e instanceof Error ? e.message : e
    );
  }

  let confirmationSent = false;
  if (input.email && input.email.includes("@")) {
    try {
      await send({
        to: input.email,
        subject: webinarConfirmationSubject(input),
        html: webinarConfirmationHtml(input),
        text: webinarConfirmationText(input),
      });
      // Sin enlace la confirmación no sustituye al correo del enlace.
      confirmationSent = Boolean(input.meetUrl?.trim());
    } catch (e) {
      console.error(
        "[lead-notify] webinar confirm",
        e instanceof Error ? e.message : e
      );
    }
  }
  return { confirmationSent };
}
