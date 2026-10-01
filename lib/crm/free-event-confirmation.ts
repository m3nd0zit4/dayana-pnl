import { prisma } from "@/lib/db";
import { eventConfirmationText, eventFecha, greetingName, reminderZone } from "./event-reminder-text";
import { getOperationalTimezone } from "./operational-timezone";
import { recipientFromContact, sendWhatsAppToRecipient } from "./whatsapp-outbound";
import { ensureTemplatesSubmitted } from "./whatsapp-templates";

/**
 * La confirmación por WhatsApp al inscribirse a un evento gratuito: «quedaste
 * inscrita en … el …». Texto libre (gratis) si la persona escribió en las
 * últimas 24 h; si no, la plantilla `evento_gratis_confirmacion`. Si la
 * plantilla aún no está aprobada y no hay ventana, no sale y queda el motivo:
 * el correo de confirmación ya le llegó y los recordatorios llevan el enlace.
 *
 * Una vez por persona y evento: se sella al reclamar (como los
 * recordatorios), así que reinscribirse o dos peticiones a la vez no mandan
 * dos.
 */

export const EVENT_CONFIRMATION_TEMPLATE_KEY = "evento_gratis_confirmacion";

export type EventConfirmationResult =
  | { status: "sent"; mode: "text" | "template" }
  | {
      status: "skipped";
      reason:
        | "no_event"
        | "disabled"
        | "no_schedule"
        | "already_sent"
        | "no_phone"
        | "opted_out"
        | "needs_template";
    }
  | { status: "failed"; error: string };

const SKIP_MESSAGE = {
  needs_template:
    "No escribió en las últimas 24 h y la plantilla «evento_gratis_confirmacion» no está aprobada todavía.",
  opted_out: "Pidió no recibir WhatsApp.",
  no_phone: "Sin número de WhatsApp válido.",
} as const;

const saveError = (webinarId: string, contactId: string, message: string) =>
  prisma.webinarRegistration
    .updateMany({
      where: { webinarId, contactId },
      data: { confirmationWaError: message.slice(0, 300) },
    })
    .catch(() => undefined);

export const sendFreeEventConfirmationWhatsApp = async (input: {
  webinarId: string;
  contactId: string;
}): Promise<EventConfirmationResult> => {
  const { webinarId, contactId } = input;
  const event = await prisma.freeWebinar.findUnique({
    where: { id: webinarId },
    select: { id: true, headline: true, startsAt: true, startsAtHasTime: true, waConfirmationEnabled: true },
  });
  if (!event) return { status: "skipped", reason: "no_event" };
  if (!event.waConfirmationEnabled) return { status: "skipped", reason: "disabled" };
  if (!event.startsAt) return { status: "skipped", reason: "no_schedule" };

  // Reclamo: solo una vez por persona y evento.
  const claimed = await prisma.webinarRegistration.updateMany({
    where: { webinarId, contactId, confirmationWaSentAt: null },
    data: { confirmationWaSentAt: new Date(), confirmationWaError: null },
  });
  if (claimed.count === 0) return { status: "skipped", reason: "already_sent" };

  const [recipient, contact, opTz] = await Promise.all([
    recipientFromContact(contactId),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { timezone: true, phoneE164: true, phoneCountryIso: true },
    }),
    getOperationalTimezone(),
  ]);
  if (!recipient?.phoneE164 || !contact) {
    await saveError(webinarId, contactId, SKIP_MESSAGE.no_phone);
    return { status: "skipped", reason: "no_phone" };
  }

  const evento = `«${event.headline.replace(/\s+/g, " ").trim()}»`;
  const fecha = eventFecha({
    startsAt: event.startsAt,
    startsAtHasTime: event.startsAtHasTime,
    pass: "24h",
    opTz,
    zone: reminderZone(contact, opTz),
  });
  const nombre = greetingName(recipient.name);
  const r = await sendWhatsAppToRecipient({
    recipient,
    text: eventConfirmationText({ evento, fecha, nombre }),
    templateKey: EVENT_CONFIRMATION_TEMPLATE_KEY,
    // WhatsApp no deja un parámetro vacío: sin nombre, un saludo neutro.
    vars: { evento, fecha, nombre: nombre || "😊" },
    source: `evento:${event.id}:confirmacion`,
    isAutoReply: true,
    clientKey: `evento-confirmacion:${event.id}:${recipient.phoneE164.replace(/\D/g, "")}`,
  }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

  if (r.status === "sent") return { status: "sent", mode: r.mode };
  if (r.status === "skipped") {
    await saveError(webinarId, contactId, SKIP_MESSAGE[r.reason]);
    // La plantilla nunca se mandó a aprobar (o Meta la rechazó): se manda
    // sola, como en los envíos masivos. Como mucho una vez cada 30 min.
    if (r.reason === "needs_template") {
      await ensureTemplatesSubmitted([EVENT_CONFIRMATION_TEMPLATE_KEY]).catch(() => undefined);
    }
    return { status: "skipped", reason: r.reason };
  }
  await saveError(webinarId, contactId, `WhatsApp no lo aceptó: ${r.error}`);
  return { status: "failed", error: r.error };
};
