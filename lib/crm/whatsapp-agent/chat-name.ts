import { prisma } from "@/lib/db";
import { personFirstName } from "@/lib/person-name";
import { resolvePersonName, type NameMessage, type NameResolution } from "@/lib/sure-name";
import { isHumanReply } from "../whatsapp-learning-rules";

/**
 * El nombre seguro de la persona de un chat (`resolvePersonName`), con su
 * perfil, su contacto y el chat. Lo usan la IA y los mensajes que salen solos
 * (recordatorios, seguimiento, «no te conectaste»): ninguno saluda con un
 * nombre que no es seguro.
 */

/** Los mensajes que se leen para buscar el nombre (los más nuevos). */
const READ = 400;

/**
 * Contactos que el CRM creó copiando el nombre del perfil de WhatsApp (o el de
 * quien pagó): ese nombre no lo escribió nadie, no confirma nada. Los pone
 * `ensureConversationContact` (lib/crm/whatsapp-client-contact.ts: «Clienta de
 * WhatsApp», y receipts.ts: «Pago confirmado por WhatsApp»).
 */
const COPIED_FROM_PROFILE = new Set(["Clienta de WhatsApp", "Pago confirmado por WhatsApp"]);

/** ¿El nombre del contacto lo escribió alguien (ella en un formulario, Dayana a mano)? */
export const contactNameTyped = (c: { source: string; sourceDetail: string | null }): boolean =>
  !(c.source === "WHATSAPP_DIRECT" && c.sourceDetail !== null && COPIED_FROM_PROFILE.has(c.sourceDetail));

export const chatNameInfo = async (conversationId: string): Promise<NameResolution> => {
  const [conversation, rows] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { participantName: true, contact: { select: { firstName: true, lastName: true, source: true, sourceDetail: true } } },
    }),
    prisma.conversationMessage.findMany({
      where: { conversationId, kind: "message", body: { not: null }, status: { not: "FAILED" } },
      orderBy: { sentAt: "desc" },
      take: READ,
      select: { direction: true, body: true, isAutoReply: true, kind: true, source: true, clientKey: true },
    }),
  ]);
  const messages: NameMessage[] = rows
    .reverse()
    .map((m) => ({ from: m.direction === "INBOUND" ? "person" : isHumanReply(m) ? "dayana" : "assistant", text: m.body ?? "" }));
  const contact = conversation?.contact;
  return resolvePersonName({
    profile: conversation?.participantName,
    contact: contact ? { name: [contact.firstName, contact.lastName].filter(Boolean).join(" "), typed: contactNameTyped(contact) } : null,
    messages,
  });
};

/**
 * El nombre para un mensaje que sale solo sobre una cita (recordatorio,
 * seguimiento, «no te conectaste»): el seguro del chat; si no lo hay, el que
 * Dayana escribió en su calendario (una cita que agendó la IA lleva el del
 * perfil, que no confirma nada). null: se saluda sin nombre.
 */
export const appointmentGreetingName = async (appt: { conversationId: string | null; name: string | null; source: string }): Promise<string | null> => {
  if (appt.conversationId) {
    const r = await chatNameInfo(appt.conversationId).catch(() => null);
    if (r?.kind === "sure") return r.first;
  }
  return appt.source === "manual" ? personFirstName(appt.name) : null;
};
