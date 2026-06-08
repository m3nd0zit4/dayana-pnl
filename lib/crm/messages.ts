import { MessageChannel } from "@prisma/client";
import { prisma } from "../db";
import { buildWhatsAppUrl } from "../contact";

export const renderTemplate = (
  body: string,
  vars: Record<string, string>
): string => {
  let out = body;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
};

export const getMessageTemplate = async (key: string, locale = "es") =>
  prisma.messageTemplate.findUnique({
    where: { key_locale: { key, locale } },
  });

export const logMessage = async (input: {
  contactId: string;
  body: string;
  templateId?: string;
  staffUserId?: string;
  channel?: MessageChannel;
}) =>
  prisma.messageLog.create({
    data: {
      contactId: input.contactId,
      bodySnapshot: input.body,
      templateId: input.templateId ?? null,
      staffUserId: input.staffUserId ?? null,
      channel: input.channel ?? MessageChannel.WHATSAPP_LINK,
    },
  });

export const buildTemplatedWhatsAppUrl = async (
  contactId: string,
  templateKey: string,
  vars: Record<string, string>,
  staffUserId?: string
) => {
  const template = await getMessageTemplate(templateKey);
  const body = template
    ? renderTemplate(template.body, vars)
    : renderTemplate(`Hola {{first_name}}`, vars);

  await logMessage({
    contactId,
    body,
    templateId: template?.id,
    staffUserId,
  });

  return buildWhatsAppUrl(body);
};
