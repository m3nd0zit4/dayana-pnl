import { writeAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import { isDialableE164 } from "./e164";
import type { SmsKeyword } from "./sms-keywords";

export type InboundSmsOutcome = {
  contactId: string | null;
  applied: boolean;
};

/**
 * Aplica una palabra clave entrante al contacto dueño de ese número.
 *
 * `Contact.phoneE164` es único, así que como mucho hay una fila. Los teléfonos
 * marcadores ("+pending", "+google:uuid") nunca son un E.164 real, de modo que
 * el guard de isDialableE164 los deja fuera sin necesidad de normalizar nada:
 * Twilio ya manda E.164.
 *
 * Esto corre SIEMPRE, incluso en modo simulado o con las notificaciones
 * apagadas: una baja es contabilidad de entrada, no un envío.
 */
export const applyInboundSmsKeyword = async (input: {
  fromE164: string;
  keyword: Exclude<SmsKeyword, null>;
  messageSid: string | null;
  toE164: string | null;
}): Promise<InboundSmsOutcome> => {
  if (!isDialableE164(input.fromE164)) {
    return { contactId: null, applied: false };
  }

  const contact = await prisma.contact.findUnique({
    where: { phoneE164: input.fromE164 },
    select: { id: true, notifySms: true },
  });

  if (!contact) {
    // Sin contacto no hay dónde guardar la preferencia. Se deja rastro y ya:
    // una tabla de bajas sueltas sería una segunda fuente de verdad que
    // resolveRecipient() también tendría que consultar.
    await writeAuditLog({
      action: "SMS_OPT_OUT_UNKNOWN_NUMBER",
      entityType: "Contact",
      entityId: "unknown",
      changes: {
        phone: input.fromE164,
        keyword: input.keyword,
        messageSid: input.messageSid,
      },
    });
    return { contactId: null, applied: false };
  }

  if (input.keyword === "HELP") return { contactId: contact.id, applied: false };

  const notifySms = input.keyword === "START";
  if (contact.notifySms === notifySms) {
    return { contactId: contact.id, applied: false };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { notifySms },
  });

  await writeAuditLog({
    action: notifySms ? "SMS_OPT_IN" : "SMS_OPT_OUT",
    entityType: "Contact",
    entityId: contact.id,
    changes: {
      keyword: input.keyword,
      from: input.fromE164,
      to: input.toE164,
      messageSid: input.messageSid,
    },
  });

  return { contactId: contact.id, applied: true };
};
