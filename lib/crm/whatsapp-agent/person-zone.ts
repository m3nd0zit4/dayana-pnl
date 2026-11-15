import { prisma } from "@/lib/db";
import { inferPersonZone, trustedContactTimezone } from "./booking-time";

/**
 * La zona de la persona de un chat, como la usa la IA (`run.ts`): la de su ficha, la
 * del contacto (si no es la de Colombia puesta por defecto) o la que se deduce del
 * chat o de su número. `null` si no se sabe. Para lo que escribe el panel en su
 * nombre (botón «Horas libres», 14-nov: a Jorge, en Chile, le llegaron solo horas de
 * Colombia).
 */
export const chatPersonZone = async (
  conversation: { id: string; externalThreadId: string | null; contactId: string | null }
): Promise<string | null> => {
  const [dossier, contact, recent] = await Promise.all([
    prisma.whatsAppDossier.findUnique({ where: { conversationId: conversation.id }, select: { timezone: true } }).catch(() => null),
    conversation.contactId
      ? prisma.contact
          .findUnique({ where: { id: conversation.contactId }, select: { timezone: true, countryIso: true, phoneCountryIso: true } })
          .catch(() => null)
      : null,
    prisma.conversationMessage
      .findMany({
        where: { conversationId: conversation.id, direction: "INBOUND" },
        orderBy: { sentAt: "desc" },
        take: 40,
        select: { direction: true, body: true },
      })
      .catch(() => []),
  ]);
  return (
    dossier?.timezone ??
    trustedContactTimezone(contact) ??
    inferPersonZone(conversation.externalThreadId ?? "", recent.reverse() as { direction: "INBOUND" | "OUTBOUND"; body: string | null }[])?.timezone ??
    null
  );
};
