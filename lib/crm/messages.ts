import { MessageChannel } from "@prisma/client";
import { prisma } from "../db";
import { buildWhatsAppUrl } from "../contact";
import { isQuickMessageTemplate } from "./quick-message-templates";

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

/** Operator-facing templates only — excludes system templates (payment receipts, cron reminders). */
export const listQuickMessageTemplates = async (locale = "es") => {
  const templates = await prisma.messageTemplate.findMany({
    where: { locale },
    orderBy: { key: "asc" },
  });
  return templates.filter((t) => isQuickMessageTemplate(t.key));
};

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
