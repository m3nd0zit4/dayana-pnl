import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { sendMetaMessage } from "@/lib/meta/send";
import { resolveWindow } from "@/lib/meta/window";
import { sureFirstName } from "@/lib/sure-name";
import { getDateKeyInTz } from "@/lib/datetime/zoned-time";
import { getOperationalTimezone } from "./operational-timezone";
import { getWhatsAppAiConfig } from "./whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "./whatsapp-autoreply";
import { fillVars, templateParams } from "./whatsapp-outbound-plan";
import { approvedTemplateFor } from "./whatsapp-templates";
import { sanitizeMensaje } from "./event-template-vars";
import { personZoneFor } from "./whatsapp-agent/booking-time";
import { chatNameInfo } from "./whatsapp-agent/chat-name";
import { offerFreeCallSlots, upcomingFreeCall } from "./whatsapp-agent/free-call";
import { slotLabel } from "./whatsapp-agent/free-call-rules";
import { computeSegment } from "./whatsapp-agent/segment-store";
import { offerList } from "./whatsapp-agent/slot-choice";
import { NO_FREE_CALL_STAGES } from "./whatsapp-agent/stage";
import { GUARD_SELECT, waitingRoomBlocked } from "./whatsapp-agent/waiting-room";
import { workshopOfferTemplateMessage, workshopOfferText, workshopOutreachSource } from "./whatsapp-agent/workshop-interest";
import { enrolledInWorkshop } from "./workshop-interests";

/**
 * «Ofrecerle la llamada» en la lista de interesadas (dueña, 24-oct: «para que
 * Dayana sepa cuáles son y llamarles o agendarles por el modelo»). La IA le
 * escribe a esa persona por el taller:
 *
 * - dentro de las 24 h de WhatsApp: el taller y 2–3 horas libres de verdad en
 *   la lista numerada del código; las horas quedan como ofrecidas (como el
 *   mensaje de reagendar), así «la 2» la agenda el código (`booking-turn.ts`);
 * - fuera: la plantilla aprobada `retomar_conversacion` con el taller y «¿Quieres
 *   que te la separe?»; si dice que sí, la IA sigue el agendamiento.
 *
 * El mensaje lleva `source` `asistente:taller:<edición>`: durante 3 días su
 * respuesta sigue lo del taller aunque ya haya tenido su llamada gratis
 * (`workshopFlowActive`). No se le escribe si ya pagó el taller, si ya tiene
 * llamada con Dayana o si la IA no atiende ese chat o no podría agendarle
 * (los mismos silencios que el seguimiento del cierre —favorito, tomado,
 * Manual, clienta, personal— más por revisar, asignado y la agenda apagada).
 */

export type OfferSkip = "not_found" | "closed" | "paid" | "has_call" | "ai_off" | "needs_template" | "already";

export type OfferResult =
  | { status: "sent"; via: "text" | "template"; slots: number; at: Date }
  | { status: "skipped"; reason: OfferSkip; detail?: string }
  | { status: "failed"; error: string };

type Deps = { send?: typeof sendMetaMessage; now?: Date };

const loadConversation = (id: string) =>
  prisma.conversation.findUnique({
    where: { id },
    select: {
      ...GUARD_SELECT,
      channel: true,
      assignedStaffId: true,
      contact: { select: { firstName: true, timezone: true, countryIso: true, phoneCountryIso: true } },
      dossier: { select: { segment: true, timezone: true } },
    },
  });

export const offerWorkshopCall = async (
  input: { editionId: string; interestId: string; staffId?: string | null },
  deps: Deps = {}
): Promise<OfferResult> => {
  const send = deps.send ?? sendMetaMessage;
  const now = deps.now ?? new Date();
  const [interest] = await prisma.$queryRaw<{ id: string; conversation_id: string; status: string }[]>`
    SELECT id, conversation_id, status FROM workshop_interests
    WHERE id = ${input.interestId} AND edition_id = ${input.editionId}`;
  if (!interest) return { status: "skipped", reason: "not_found" };

  const edition = await prisma.workshopEdition.findUnique({
    where: { id: input.editionId },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      endedAt: true,
      startsAt: true,
      startsAtHasTime: true,
      timezone: true,
      dateLabel: true,
      scheduleLabel: true,
      cardSummary: true,
    },
  });
  if (!edition || edition.status !== "OPEN" || edition.endedAt || (edition.startsAt && edition.startsAt.getTime() < now.getTime())) {
    return { status: "skipped", reason: "closed" };
  }

  // El estado al día (como el seguimiento del cierre): por revisar, clienta o personal no.
  const seg = await computeSegment(interest.conversation_id).catch(() => null);
  const conv = await loadConversation(interest.conversation_id);
  if (!conv || conv.channel !== "WHATSAPP") return { status: "skipped", reason: "not_found" };
  if (conv.contactId && (await enrolledInWorkshop(conv.contactId, edition.id))) return { status: "skipped", reason: "paid" };

  // La IA tiene que poder contestarle y agendarle cuando responda (lo mismo que mira `run.ts`).
  const config = await getWhatsAppAiConfig();
  if (!(await isWhatsAppAutoReplyEnabled())) return { status: "skipped", reason: "ai_off", detail: "La IA está apagada en WhatsApp." };
  if (!config.salesFlow.enabled || !config.booking.enabled) {
    return { status: "skipped", reason: "ai_off", detail: "La agenda de la IA está apagada (Ajustes → IA)." };
  }
  if (seg && (seg.review || (NO_FREE_CALL_STAGES.has(seg.stage) && seg.stage !== "tuvo_llamada" && seg.stage !== "clienta_pasada"))) {
    return { status: "skipped", reason: "ai_off", detail: "Está por revisar, es clienta o es un chat personal: escríbele tú." };
  }
  if (conv.assignedStaffId && !conv.aiAlwaysAt) {
    return { status: "skipped", reason: "ai_off", detail: "El chat está asignado a alguien del equipo: escríbele tú." };
  }
  if (await waitingRoomBlocked(conv, config)) {
    return { status: "skipped", reason: "ai_off", detail: "La IA no atiende este chat (favorito, tomado, Manual, pausa o clienta)." };
  }

  // Con la llamada ya agendada, en ella Dayana le explica y la inscribe.
  const call = await upcomingFreeCall(conv.id, config, now).catch(() => null);
  const appt =
    call ??
    (await prisma.calendarAppointment.findFirst({
      where: { conversationId: conv.id, status: "active", startsAt: { gte: now } },
      select: { startsAt: true },
    }));
  if (appt) return { status: "skipped", reason: "has_call" };

  const firstName = sureFirstName(await chatNameInfo(conv.id));
  const source = workshopOutreachSource(edition);
  // Un toque por día: el doble clic o el reintento devuelve el mismo mensaje.
  const dayanaTz = await getOperationalTimezone();
  const clientKey = `taller-interes:${interest.id}:${getDateKeyInTz(now, dayanaTz)}`;
  // Ya salió hoy: otra lista con otras horas no cuadraría con la que tiene.
  const sentToday = await prisma.conversationMessage.findFirst({
    where: { clientKey, status: { not: "FAILED" } },
    select: { id: true },
  });
  if (sentToday) return { status: "skipped", reason: "already" };
  const windowOpen = resolveWindow("WHATSAPP", conv.lastInboundAt, now).isOpen;

  let via: "text" | "template";
  let options: { startIso: string; label: string }[] = [];
  try {
    if (windowOpen) {
      const personTz = personZoneFor({ dossierTz: conv.dossier?.timezone, contact: conv.contact, phone: conv.externalThreadId });
      options = (await offerFreeCallSlots({ config, personTz: personTz ?? dayanaTz, dayanaTz, now }).catch(() => [])).map((o) => ({
        ...o,
        label: slotLabel(o.startIso, personTz, dayanaTz),
      }));
      await send({
        conversationId: conv.id,
        body: workshopOfferText(edition, { firstName, slotList: options.length ? offerList(options) : null }),
        source,
        isAutoReply: true,
        clientKey,
      });
      via = "text";
    } else {
      const template = await approvedTemplateFor("retomar_conversacion");
      if (!template?.metaTemplateName) {
        return { status: "skipped", reason: "needs_template", detail: "Pasaron más de 24 h y la plantilla «Retomar la conversación» no está aprobada." };
      }
      // Sin nombre seguro, «Hola 😊,» como los recordatorios (WhatsApp no acepta el parámetro vacío).
      const vars = { nombre: firstName ?? "😊", mensaje: sanitizeMensaje(workshopOfferTemplateMessage(edition)) };
      await send({
        conversationId: conv.id,
        body: fillVars(template.body, vars),
        template: {
          name: template.metaTemplateName,
          language: template.metaTemplateLang ?? "es",
          variables: templateParams(template.metaVarNames, vars),
        },
        source,
        isAutoReply: true,
        clientKey,
      });
      via = "template";
    }
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }

  // Ya salió: lo que sigue no lo deshace (si falla, queda en el registro y se avisa como enviado).
  // Las horas quedan como ofrecidas: si elige una, se agenda (`latestFreeCallOffer`).
  if (via === "text" && options.length) {
    await prisma.whatsAppAiRun
      .create({
        data: {
          conversationId: conv.id,
          status: "REPLIED",
          reason: "workshop_offer",
          toolCalls: [{ tool: "offer_free_call_slots", input: {}, output: { ok: true, options } }] as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          latencyMs: 0,
        },
      })
      .catch((e: unknown) => console.warn("[talleres] no se guardaron las horas ofrecidas", e));
  }
  await prisma.$executeRaw`
    UPDATE workshop_interests
    SET offered_at = ${now}, offered_via = ${via},
        status = CASE WHEN status = 'nuevo' THEN 'contactada' ELSE status END,
        updated_at = NOW()
    WHERE id = ${interest.id}`.catch((e: unknown) => console.warn("[talleres] no se marcó la oferta", e));
  const slots = options.length;
  return { status: "sent", via, slots, at: now };
};
