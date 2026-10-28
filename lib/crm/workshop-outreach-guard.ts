import { prisma } from "@/lib/db";
import type { WhatsAppAiConfig } from "./whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "./whatsapp-autoreply";
import { upcomingFreeCall } from "./whatsapp-agent/free-call";
import type { SegmentResult } from "./whatsapp-agent/segment-store";
import { NO_FREE_CALL_STAGES } from "./whatsapp-agent/stage";
import { GUARD_SELECT, waitingRoomBlocked } from "./whatsapp-agent/waiting-room";
import { enrolledInWorkshop } from "./workshop-interests";

/**
 * Cuándo la IA NO le escribe a alguien por el taller. Lo comparten «Que la IA
 * le escriba» de la lista de interesadas (`offerWorkshopCall`, 24-oct) y la
 * invitación a quienes se inscribieron en un evento gratuito
 * (`workshop-invite.ts`, 28-oct): la IA tiene que poder contestarle y
 * agendarle cuando responda (lo mismo que mira `run.ts`), y no se le escribe a
 * quien ya pagó, ya tiene llamada con Dayana, es clienta, está por revisar, es
 * un chat personal, está asignado a alguien del equipo o la IA no atiende.
 */

export const OUTREACH_CONVERSATION_SELECT = {
  ...GUARD_SELECT,
  channel: true,
  assignedStaffId: true,
  contact: { select: { firstName: true, timezone: true, countryIso: true, phoneCountryIso: true } },
  dossier: { select: { segment: true, timezone: true } },
} as const;

export const loadOutreachConversation = (id: string) =>
  prisma.conversation.findUnique({ where: { id }, select: OUTREACH_CONVERSATION_SELECT });

export type OutreachConversation = NonNullable<Awaited<ReturnType<typeof loadOutreachConversation>>>;

/** Lo que apaga a la IA para todos: sin ella nadie le seguiría la respuesta. */
export const outreachAiOff = async (config: WhatsAppAiConfig): Promise<string | null> => {
  if (!(await isWhatsAppAutoReplyEnabled())) return "La IA está apagada en WhatsApp.";
  if (!config.salesFlow.enabled || !config.booking.enabled) return "La agenda de la IA está apagada (Ajustes → IA).";
  return null;
};

export type OutreachRefusal =
  | { reason: "paid"; detail: string }
  | { reason: "has_call"; detail: string }
  | { reason: "segment"; detail: string }
  | { reason: "assigned"; detail: string }
  | { reason: "blocked"; detail: string };

/**
 * Las de una persona. `seg` es su estado recién calculado (`computeSegment`).
 * `pastClientsOk`: «Que la IA le escriba» admite a quien ya fue clienta y
 * preguntó por el taller; la invitación masiva no (las clientas las atiende Dayana).
 */
export const outreachRefusal = async (
  conv: OutreachConversation,
  input: { editionId: string; config: WhatsAppAiConfig; now: Date; seg: SegmentResult | null; pastClientsOk: boolean }
): Promise<OutreachRefusal | null> => {
  if (conv.contactId && (await enrolledInWorkshop(conv.contactId, input.editionId))) {
    return { reason: "paid", detail: "Ya pagó el taller." };
  }
  const seg = input.seg;
  const allowed = (stage: string) => stage === "tuvo_llamada" || (input.pastClientsOk && stage === "clienta_pasada");
  if (
    seg &&
    (seg.review ||
      (!input.pastClientsOk && seg.segment === "client") ||
      (NO_FREE_CALL_STAGES.has(seg.stage) && !allowed(seg.stage)))
  ) {
    return { reason: "segment", detail: "Está por revisar, es clienta o es un chat personal: escríbele tú." };
  }
  if (conv.assignedStaffId && !conv.aiAlwaysAt) {
    return { reason: "assigned", detail: "El chat está asignado a alguien del equipo: escríbele tú." };
  }
  if (await waitingRoomBlocked(conv, input.config)) {
    return { reason: "blocked", detail: "La IA no atiende este chat (favorito, tomado, Manual, pausa o clienta)." };
  }
  // Con la llamada ya agendada, en ella Dayana le explica y la inscribe.
  const call = await upcomingFreeCall(conv.id, input.config, input.now).catch(() => null);
  const appt =
    call ??
    (await prisma.calendarAppointment.findFirst({
      where: { conversationId: conv.id, status: "active", startsAt: { gte: input.now } },
      select: { startsAt: true },
    }));
  if (appt) return { reason: "has_call", detail: "Ya tiene una llamada agendada con Dayana." };
  return null;
};
