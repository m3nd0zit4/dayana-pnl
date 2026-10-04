import { prisma } from "@/lib/db";
import { eventConfirmationText, eventFecha, greetingName, reminderZone } from "./event-reminder-text";
import { confirmationCapReason, EVENT_CONFIRMATION_CAP } from "./free-event-rules";
import { getOperationalTimezone } from "./operational-timezone";
import { recipientFromContact, sendWhatsAppToRecipient } from "./whatsapp-outbound";
import { EVENT_ACCESS_TEMPLATE_KEY, EVENT_TEMPLATE_KEYS_TO_ENSURE } from "./event-reminder-template";
import { EVENT_ACCESS_BODY, eventTemplateVars, renderEventTemplate } from "./event-template-vars";
import { approvedUtilityTemplateFor, ensureTemplatesSubmitted } from "./whatsapp-templates";

/**
 * La confirmación por WhatsApp al inscribirse a un evento gratuito: «quedaste
 * inscrita en … el …». Texto libre (gratis) si la persona escribió en las
 * últimas 24 h; si no, la plantilla: `evento_acceso` (con los horarios por
 * país y el enlace, o la página del evento si aún no hay) en cuanto Meta la
 * aprueba como UTILITY; mientras tanto `evento_gratis_confirmacion`. Si la
 * plantilla aún no está aprobada y no hay ventana, no sale y queda el motivo:
 * el correo de confirmación ya le llegó y los recordatorios llevan el enlace.
 *
 * Una vez por persona y evento: se sella al reclamar (como los
 * recordatorios), así que reinscribirse o dos peticiones a la vez no mandan
 * dos.
 *
 * Y con tope por evento (`EVENT_CONFIRMATION_CAP`): el formulario es público
 * y la plantilla se paga, así que un bot con números inventados no puede
 * convertirla en un gasto. Pasado el tope no sale el WhatsApp (queda el
 * motivo); el correo sí.
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
        | "needs_template"
        | "capped";
    }
  | { status: "failed"; error: string };

const skipMessage = (templateKey: string) =>
  ({
    needs_template: `No escribió en las últimas 24 h y la plantilla «${templateKey}» no está aprobada todavía.`,
    opted_out: "Pidió no recibir WhatsApp.",
    no_phone: "Sin número de WhatsApp válido.",
  }) as const;

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
    select: {
      id: true,
      slug: true,
      headline: true,
      startsAt: true,
      startsAtHasTime: true,
      meetUrl: true,
      waConfirmationEnabled: true,
    },
  });
  if (!event) return { status: "skipped", reason: "no_event" };
  if (!event.waConfirmationEnabled) return { status: "skipped", reason: "disabled" };
  if (!event.startsAt) return { status: "skipped", reason: "no_schedule" };

  // Tope: cuántas confirmaciones salieron de verdad (sello sin error) en la
  // última hora y el último día. Dos inscripciones a la vez pueden pasarlo
  // por una o dos; es un freno de gasto, no una cuenta exacta.
  const now = Date.now();
  const sentSince = (ms: number) =>
    prisma.webinarRegistration.count({
      where: { webinarId, confirmationWaSentAt: { gte: new Date(now - ms) }, confirmationWaError: null },
    });
  const [lastHour, lastDay] = await Promise.all([sentSince(60 * 60_000), sentSince(24 * 60 * 60_000)]);
  const capped = confirmationCapReason({ lastHour, lastDay });
  if (capped) {
    // Se sella con el motivo: no se reintenta sola.
    const stamped = await prisma.webinarRegistration.updateMany({
      where: { webinarId, contactId, confirmationWaSentAt: null },
      data: {
        confirmationWaSentAt: new Date(),
        confirmationWaError:
          capped === "hour"
            ? `Tope: más de ${EVENT_CONFIRMATION_CAP.perHour} confirmaciones en una hora; no se envió (le llegó el correo).`
            : `Tope: más de ${EVENT_CONFIRMATION_CAP.perDay} confirmaciones en un día; no se envió (le llegó el correo).`,
      },
    });
    return { status: "skipped", reason: stamped.count === 0 ? "already_sent" : "capped" };
  }

  // Reclamo: solo una vez por persona y evento.
  const claimed = await prisma.webinarRegistration.updateMany({
    where: { webinarId, contactId, confirmationWaSentAt: null },
    data: { confirmationWaSentAt: new Date(), confirmationWaError: null },
  });
  if (claimed.count === 0) return { status: "skipped", reason: "already_sent" };

  const [recipient, contact, opTz, access] = await Promise.all([
    recipientFromContact(contactId),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { timezone: true, phoneE164: true, phoneCountryIso: true },
    }),
    getOperationalTimezone(),
    approvedUtilityTemplateFor(EVENT_ACCESS_TEMPLATE_KEY).catch(() => null),
  ]);
  const templateKey = access ? EVENT_ACCESS_TEMPLATE_KEY : EVENT_CONFIRMATION_TEMPLATE_KEY;
  const SKIP_MESSAGE = skipMessage(templateKey);
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
  const accessVars = access ? eventTemplateVars(event, { for: "inscrita" }) : null;
  const r = await sendWhatsAppToRecipient({
    recipient,
    text: accessVars
      ? renderEventTemplate(EVENT_ACCESS_BODY, accessVars, nombre)
      : eventConfirmationText({ evento, fecha, nombre }),
    templateKey,
    ...(access ? { template: access } : {}),
    // WhatsApp no deja un parámetro vacío: sin nombre, un saludo neutro.
    vars: { ...(accessVars ?? { evento, fecha }), nombre: nombre || "😊" },
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
      await ensureTemplatesSubmitted([EVENT_CONFIRMATION_TEMPLATE_KEY, ...EVENT_TEMPLATE_KEYS_TO_ENSURE]).catch(
        () => undefined
      );
    }
    return { status: "skipped", reason: r.reason };
  }
  await saveError(webinarId, contactId, `WhatsApp no lo aceptó: ${r.error}`);
  return { status: "failed", error: r.error };
};
