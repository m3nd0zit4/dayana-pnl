import {
  MessageChannel,
  NotificationDeliveryStatus,
  type Prisma,
} from "@prisma/client";
import { renderQuickMessage } from "@/lib/crm/render-message";
import { prisma } from "@/lib/db";
import { sendEmail } from "./channels/email";
import { sendSms } from "./channels/sms";
import { sendWhatsAppTemplateMessage } from "./channels/whatsapp";
import {
  campaignEmailHtml,
  campaignEmailSubject,
  campaignPlainText,
} from "./templates/campaign-email";
import {
  paymentConfirmationHtml,
  paymentConfirmationSubject,
  paymentConfirmationText,
} from "./templates/payment-confirmation";
import {
  channelConfigured,
  isNotificationsEnabled,
  type OutboundChannel,
} from "./config";
import type { TemplateVars } from "./variables";

export type DispatchPayload = {
  contactId: string;
  channel: OutboundChannel;
  templateKey?: string;
  subject?: string;
  body: string;
  html?: string;
  text?: string;
  recipient?: string;
  campaignId?: string;
  vars?: TemplateVars;
};

const resolveRecipient = async (
  contactId: string,
  channel: OutboundChannel
): Promise<string | null> => {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, phoneE164: true, consentMarketingAt: true },
  });
  if (!contact) return null;

  if (channel === "EMAIL") return contact.email;
  if (channel === "SMS" || channel === "WHATSAPP_API") {
    return contact.phoneE164;
  }
  return null;
};

const buildEmailContent = (
  payload: DispatchPayload,
  vars: TemplateVars,
  templateTitle: string
) => {
  if (payload.templateKey === "payment_confirmation" && payload.html) {
    return {
      subject: payload.subject ?? paymentConfirmationSubject(vars),
      html: payload.html,
      text: payload.text ?? paymentConfirmationText(vars),
    };
  }

  const subject =
    payload.subject ?? campaignEmailSubject(templateTitle, vars);
  const html =
    payload.html ?? campaignEmailHtml(templateTitle, payload.body, vars);
  const text =
    payload.text ?? campaignPlainText(payload.body, vars);

  return { subject, html, text };
};

export const dispatchToChannel = async (
  payload: DispatchPayload
): Promise<{
  status: NotificationDeliveryStatus;
  providerId?: string;
  errorMessage?: string;
  recipient?: string;
}> => {
  if (!isNotificationsEnabled()) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      errorMessage: "NOTIFICATIONS_ENABLED no está activo",
    };
  }

  if (!channelConfigured(payload.channel)) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      errorMessage: `Canal ${payload.channel} sin credenciales`,
    };
  }

  const recipient =
    payload.recipient ?? (await resolveRecipient(payload.contactId, payload.channel));

  if (!recipient) {
    return {
      status: NotificationDeliveryStatus.SKIPPED,
      errorMessage: "Contacto sin email o teléfono para este canal",
    };
  }

  const vars = payload.vars ?? {};
  let templateTitle = payload.templateKey ?? "Mensaje";

  if (payload.templateKey) {
    const tpl = await prisma.messageTemplate.findUnique({
      where: { key_locale: { key: payload.templateKey, locale: "es" } },
    });
    if (tpl?.title) templateTitle = tpl.title;
  }

  const smsBody = renderQuickMessage(payload.body, vars);

  try {
    let providerId: string | undefined;
    let messageId: string | undefined;

    if (payload.channel === "EMAIL") {
      const { subject, html, text } = buildEmailContent(
        payload,
        vars,
        templateTitle
      );
      const result = await sendEmail({
        to: recipient,
        subject,
        html,
        text,
      });
      providerId = result.providerId;
      messageId = result.messageId;
    } else if (payload.channel === "SMS") {
      const result = await sendSms({ toE164: recipient, body: smsBody });
      providerId = result.providerId;
      messageId = result.messageId;
    } else if (payload.channel === "WHATSAPP_API") {
      const result = await sendWhatsAppTemplateMessage({
        toE164: recipient,
        body: smsBody,
      });
      providerId = result.providerId;
      messageId = result.messageId;
    }

    return {
      status: NotificationDeliveryStatus.SENT,
      providerId: messageId ? `${providerId}:${messageId}` : providerId,
      recipient,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: NotificationDeliveryStatus.FAILED,
      errorMessage: msg,
      recipient,
    };
  }
};

export const recordDelivery = async (input: {
  contactId: string;
  channel: MessageChannel;
  templateKey?: string;
  subject?: string;
  bodySnapshot: string;
  campaignId?: string;
  result: {
    status: NotificationDeliveryStatus;
    providerId?: string;
    errorMessage?: string;
    recipient?: string;
  };
}) => {
  const delivery = await prisma.notificationDelivery.create({
    data: {
      campaignId: input.campaignId ?? null,
      contactId: input.contactId,
      channel: input.channel,
      status: input.result.status,
      templateKey: input.templateKey ?? null,
      subject: input.subject ?? null,
      bodySnapshot: input.bodySnapshot,
      recipient: input.result.recipient ?? null,
      providerId: input.result.providerId ?? null,
      errorMessage: input.result.errorMessage ?? null,
      sentAt:
        input.result.status === NotificationDeliveryStatus.SENT
          ? new Date()
          : null,
    },
  });

  if (input.result.status === NotificationDeliveryStatus.SENT) {
    await prisma.messageLog.create({
      data: {
        contactId: input.contactId,
        channel: input.channel,
        bodySnapshot: input.bodySnapshot,
      },
    });
  }

  return delivery;
};

export const dispatchAndRecord = async (payload: DispatchPayload) => {
  const result = await dispatchToChannel(payload);
  const delivery = await recordDelivery({
    contactId: payload.contactId,
    channel: payload.channel,
    templateKey: payload.templateKey,
    subject: payload.subject,
    bodySnapshot: payload.body,
    campaignId: payload.campaignId,
    result,
  });
  return { delivery, result };
};

export const incrementCampaignStats = async (
  campaignId: string,
  delta: Prisma.NotificationCampaignUpdateInput
) => {
  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: delta,
  });
};
