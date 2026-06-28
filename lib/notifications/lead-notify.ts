import { sendEmail } from "./channels/email";
import { emailFrom } from "./config";
import {
  leadConfirmationHtml,
  leadConfirmationSubject,
  leadConfirmationText,
  leadNotificationHtml,
  leadNotificationSubject,
  leadNotificationText,
  type LeadEmailInput,
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
