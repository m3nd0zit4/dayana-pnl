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
import { chatNameInfo } from "./whatsapp-agent/chat-name";
import { upcomingFreeCall } from "./whatsapp-agent/free-call";
import { computeSegment } from "./whatsapp-agent/segment-store";
import { NO_FREE_CALL_STAGES } from "./whatsapp-agent/stage";
import { GUARD_SELECT, waitingRoomBlocked } from "./whatsapp-agent/waiting-room";
import { workshopOfferTemplateMessage, workshopOfferText, workshopOutreachSource } from "./whatsapp-agent/workshop-interest";
import { enrolledInWorkshop, workshopPayUrl } from "./workshop-interests";

/**
 * «Que la IA le escriba» en la lista de interesadas (dueña, 24-oct: «para que
 * Dayana sepa cuáles son y llamarles o agendarles por el modelo»). La IA le
 * escribe a esa persona por el taller: que está abierto, cuándo es y si quiere
 * separar su cupo de una vez (el enlace de pago) o agendar primero la llamada
 * con Dayana (25-oct: «que pregunte si para separar su cupo o agendar»; sin
 * enlace de pago, solo la llamada). Lo que conteste lo sigue la IA: el enlace
 * o las horas.
 *
 * - dentro de las 24 h de WhatsApp: un mensaje de texto;
 * - fuera: la plantilla aprobada `retomar_conversacion` con ese texto.
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
  | { status: "sent"; via: "text" | "template"; at: Date }
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
      product: { select: { id: true, isActive: true, prices: { select: { id: true }, take: 1 } } },
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
  const workshop = { ...edition, payUrl: workshopPayUrl(edition.product) };
  const source = workshopOutreachSource(edition);
  // Un toque por día: el doble clic o el reintento devuelve el mismo mensaje.
  const dayanaTz = await getOperationalTimezone();
  const clientKey = `taller-interes:${interest.id}:${getDateKeyInTz(now, dayanaTz)}`;
  // Ya salió hoy: no se le repite.
  const sentToday = await prisma.conversationMessage.findFirst({
    where: { clientKey, status: { not: "FAILED" } },
    select: { id: true },
  });
  if (sentToday) return { status: "skipped", reason: "already" };
  const windowOpen = resolveWindow("WHATSAPP", conv.lastInboundAt, now).isOpen;

  let via: "text" | "template";
  try {
    if (windowOpen) {
      await send({
        conversationId: conv.id,
        body: workshopOfferText(workshop, { firstName }),
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
      const vars = { nombre: firstName ?? "😊", mensaje: sanitizeMensaje(workshopOfferTemplateMessage(workshop)) };
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

  // Ya salió: si no se marca, queda en el registro y se avisa como enviado.
  await prisma.$executeRaw`
    UPDATE workshop_interests
    SET offered_at = ${now}, offered_via = ${via},
        status = CASE WHEN status = 'nuevo' THEN 'contactada' ELSE status END,
        updated_at = NOW()
    WHERE id = ${interest.id}`.catch((e: unknown) => console.warn("[talleres] no se marcó la oferta", e));
  return { status: "sent", via, at: now };
};
