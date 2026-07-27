import { MessageChannel } from "@prisma/client";
import { prisma } from "../db";
import { buildWhatsAppUrl } from "../contact";
import {
  isAgentSendableTemplate,
  isQuickMessageTemplate,
  templateVariableNames,
} from "./quick-message-templates";

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

/**
 * Plantillas que el asistente puede usar, anotadas por canal.
 *
 * Los dos canales no permiten lo mismo: WhatsApp pasa por una persona que
 * revisa el texto antes de enviarlo, el correo no. Devolver ambas banderas —
 * junto con las variables que pide cada plantilla — evita que el modelo
 * descubra la diferencia a base de errores.
 */
export const listAgentTemplates = async (locale = "es") => {
  const templates = await prisma.messageTemplate.findMany({
    where: { locale },
    orderBy: { key: "asc" },
  });
  return templates
    .filter((t) => isAgentSendableTemplate(t.key) || isQuickMessageTemplate(t.key))
    .map((t) => ({
      key: t.key,
      title: t.title,
      body: t.body,
      requiredVars: templateVariableNames(t.body),
      canEmail: isAgentSendableTemplate(t.key),
      canWhatsApp: isQuickMessageTemplate(t.key),
    }));
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
