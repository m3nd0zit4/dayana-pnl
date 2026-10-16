import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { personFullName } from "@/lib/person-name";
import { phoneFromWhatsAppId } from "@/lib/phone";
import { contactPhoneCandidates } from "@/lib/whatsapp-contact";
import { upsertContactByPhone } from "./contacts";
import { linkConversationToContact } from "./conversations";

/**
 * Toda clienta que escribe por WhatsApp queda como contacto del CRM (pedido de
 * la dueña, 15-oct-2026): cuando Dayana confirma su comprobante (con el botón
 * o respondiendo «recibido» desde el celular), cuando la marca como clienta, o
 * cuando el estado del chat dice que es clienta confirmada. Antes solo se
 * creaba al confirmar un comprobante, y a una clienta de México no se le podía
 * crear (su número llega como 521…).
 */

export class ClientContactError extends Error {}

/** Nombre y apellido para el contacto: el de WhatsApp si es un nombre, si no el del comprobante. */
const contactName = (participantName: string | null, payerName: string | null) => {
  const full = personFullName(participantName) ?? personFullName(payerName);
  const words = full?.split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return { firstName: "Cliente WhatsApp" };
  return { firstName: words[0], ...(words.length > 1 ? { lastName: words.slice(1).join(" ") } : {}) };
};

/**
 * El contacto del chat: el que ya tiene, uno que ya existe con el mismo número
 * (en cualquiera de sus formas), o uno nuevo. Lanza `no_phone` si el chat es
 * de un usuario de WhatsApp sin número (BSUID): ese se vincula a mano.
 */
export const ensureConversationContact = async (input: {
  conversationId: string;
  staffUserId: string | null;
  /** Por qué se crea, para la ficha del contacto. */
  sourceDetail: string;
  /** El nombre que se vio en el comprobante, si el de WhatsApp no sirve. */
  payerName?: string | null;
}): Promise<{ contactId: string; created: boolean }> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, channel: true, externalThreadId: true, participantName: true, contactId: true },
  });
  if (!conversation) throw new ClientContactError("not_found");
  if (conversation.contactId) return { contactId: conversation.contactId, created: false };
  if (conversation.channel !== "WHATSAPP") throw new ClientContactError("no_phone");

  // Ya está en el CRM con otra forma del mismo número (+52 / +521, +54 / +549…).
  const findExisting = () =>
    prisma.contact.findFirst({
      where: { phoneE164: { in: contactPhoneCandidates(conversation.externalThreadId) } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  let contactId = (await findExisting())?.id ?? null;
  let created = false;
  if (!contactId) {
    const phone = phoneFromWhatsAppId(conversation.externalThreadId);
    if (!phone) throw new ClientContactError("no_phone");
    try {
      const result = await upsertContactByPhone({
        phone: phone.phoneE164,
        countryIso: phone.phoneCountryIso,
        ...contactName(conversation.participantName, input.payerName ?? null),
        source: "WHATSAPP_DIRECT",
        sourceDetail: input.sourceDetail,
      });
      contactId = result.contact.id;
      created = result.created;
    } catch (e) {
      // Otro proceso lo creó en el mismo instante (dos comprobantes confirmados
      // a la vez): se usa ese.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      contactId = (await findExisting())?.id ?? null;
      if (!contactId) throw e;
    }
  }
  await linkConversationToContact(conversation.id, contactId, input.staffUserId);
  return { contactId, created };
};

/**
 * Dayana marcó el chat como clienta (a mano o con «Es clienta»): queda en el
 * CRM. Nunca lanza: la marca ya quedó; sin número (BSUID) solo se avisa en el log.
 * Va aparte de `setManualCategory` para no meter contactos y conversaciones
 * en todo lo que importa la categoría (el agente del panel se arma con cada
 * módulo que alcanza).
 */
export const contactForMarkedClient = async (conversationId: string, staffUserId: string | null) => {
  await ensureConversationContact({ conversationId, staffUserId, sourceDetail: "Clienta de WhatsApp" }).catch((e: unknown) =>
    console.warn("[clienta] no se pudo crear el contacto", conversationId, e instanceof Error ? e.message : e)
  );
};
