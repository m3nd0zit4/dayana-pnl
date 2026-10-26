import { prisma } from "@/lib/db";
import { classifyEmailError } from "./email-errors";

/**
 * Apaga `notifyEmail` de quien tiene una dirección que Resend rechaza por
 * formato (`422 Invalid \`to\` field`), igual que hace el webhook de Resend con
 * un rebote. Devuelve `true` si apagó algo.
 *
 * **Sólo lo llaman los barridos masivos** (recordatorios y enlace del webinar,
 * recordatorios de talleres), que reintentan a la misma persona cada diez
 * minutos: una sola acumuló 20 intentos. NO se hace desde el despachador
 * general. Ahí el correo es de una vez —confirmación de pago, invitación al
 * portal— y apagar `notifyEmail` por una errata en el checkout dejaría a ese
 * comprador sin ningún correo posterior, en silencio (los envíos pasan a
 * SKIPPED y nada avisa), y sin forma de reactivarse al corregir la dirección.
 *
 * Nunca lanza: es contabilidad del fallo, no puede esconder el fallo original.
 */
export const suppressUndeliverableEmail = async (
  contactId: string,
  errorMessage: string | null | undefined
): Promise<boolean> => {
  if (classifyEmailError(errorMessage) !== "invalid_address") return false;
  try {
    const { count } = await prisma.contact.updateMany({
      where: { id: contactId, notifyEmail: true },
      data: { notifyEmail: false },
    });
    if (count > 0) {
      console.warn(
        "[email-suppress] dirección rechazada por Resend; notifyEmail apagado",
        contactId
      );
    }
    return count > 0;
  } catch (e) {
    console.error("[email-suppress] no se pudo apagar notifyEmail", e);
    return false;
  }
};
