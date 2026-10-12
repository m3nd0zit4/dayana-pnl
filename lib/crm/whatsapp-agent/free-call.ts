import { prisma } from "@/lib/db";
import { getDateKeyInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import { fireNotification } from "@/lib/notifications/platform/emit";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { availableSlots, bookOnCalendar, SlotUnavailableError } from "./calendar";
import { isFreeCallService } from "./event-title";
import { resolveConversations } from "./pending";
import { spreadSlots } from "./slots";

/**
 * La llamada gratis de 15 minutos: el único objetivo de la asistente con una
 * persona nueva. Dayana la hace por WhatsApp (no hay enlace de Meet).
 *
 * - `offerFreeCallSlots`: 2–3 horas libres de verdad del calendario de Dayana
 *   (los bloques «Disponible», o su horario base), repartidas en días, con la
 *   hora de la persona y la de Colombia.
 * - `bookFreeCall`: agenda una de esas horas. Con un candado de base de datos
 *   para que dos personas no se queden con la misma hora, vuelve a mirar el
 *   calendario, no agenda dos llamadas gratis a la misma persona y respeta el
 *   tope diario. Deja la cita en el calendario y en el CRM al instante.
 */

export type FreeCallService = { name: string; minutes: number };

/**
 * Para las pruebas: un calendario de mentira (las pruebas nunca deben crear
 * eventos en el calendario real de Dayana).
 */
type CalendarDeps = { available?: typeof availableSlots; book?: typeof bookOnCalendar };
let calendarDeps: CalendarDeps = {};
export const setFreeCallCalendarForTests = (deps: CalendarDeps) => {
  calendarDeps = deps;
};

/** El servicio de la llamada gratis (el de Ajustes; si no, el primero que sea gratis). */
export const freeCallService = (config: WhatsAppAiConfig): FreeCallService => {
  const wanted = config.freeCall.serviceName.trim().toLowerCase();
  const byName = config.booking.services.find((s) => s.name.trim().toLowerCase() === wanted);
  const free = byName ?? config.booking.services.find((s) => isFreeCallService(s.name, s.minutes));
  return free ? { name: free.name, minutes: free.minutes } : { name: config.freeCall.serviceName, minutes: 15 };
};

const fmt = (iso: string, tz: string, withDay: boolean) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    ...(withDay ? { weekday: "long", day: "numeric", month: "long" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * «jueves 16 de octubre, 3:00 p. m. (tu hora) · 4:00 p. m. en Colombia».
 * Si la persona está en la hora de Colombia, una sola.
 */
export const dualZoneLabel = (iso: string, personTz: string, dayanaTz: string): string => {
  const mine = fmt(iso, personTz, true);
  const sameClock = fmt(iso, personTz, true) === fmt(iso, dayanaTz, true);
  return sameClock ? mine : `${mine} (tu hora) · ${fmt(iso, dayanaTz, false)} en Colombia`;
};

export type FreeCallOption = { startIso: string; label: string };

export const offerFreeCallSlots = async (input: {
  config: WhatsAppAiConfig;
  personTz: string;
  dayanaTz: string;
  now?: Date;
}): Promise<FreeCallOption[]> => {
  const service = freeCallService(input.config);
  const slots = await (calendarDeps.available ?? availableSlots)({
    config: input.config.booking,
    durationMin: service.minutes,
    timezone: input.dayanaTz,
    now: input.now,
  });
  return spreadSlots(slots, input.config.freeCall.offer).map((s) => ({
    startIso: s.startIso,
    label: dualZoneLabel(s.startIso, input.personTz, input.dayanaTz),
  }));
};

/** Las horas que la asistente ya le ofreció a esta persona (últimas 72 h): solo esas se agendan. */
export const offeredFreeCallSlots = async (conversationId: string, now = new Date()): Promise<string[]> => {
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { conversationId, queuedAt: { gte: new Date(now.getTime() - 72 * 3600_000) } },
    orderBy: { queuedAt: "desc" },
    take: 30,
    select: { toolCalls: true, status: true },
  });
  const out = new Set<string>();
  for (const r of runs) {
    // Una propuesta que Dayana canceló no se ofreció.
    if (r.status === "CANCELLED") continue;
    for (const call of (Array.isArray(r.toolCalls) ? r.toolCalls : []) as { tool?: string; output?: { options?: FreeCallOption[] } }[]) {
      if (call.tool === "offer_free_call_slots") for (const o of call.output?.options ?? []) out.add(new Date(o.startIso).toISOString());
    }
  }
  return [...out];
};

export class FreeCallError extends Error {
  constructor(public code: "already_booked" | "daily_cap" | "unavailable", message: string) {
    super(message);
  }
}

export type FreeCallBooking = { bookingId: string; startsAt: Date; endsAt: Date; title: string; label: string };

/** El día de `d` en la zona de Dayana (de medianoche a medianoche), para el tope diario. */
const dayBounds = (d: Date, tz: string): { from: Date; to: Date } => {
  const from = zonedDateTimeToUtc(getDateKeyInTz(d, tz), "00:00", tz);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
};

export const bookFreeCall = async (input: {
  config: WhatsAppAiConfig;
  dayanaTz: string;
  personTz: string;
  start: Date;
  conversationId: string;
  contactId: string | null;
  phone: string;
  name: string | null;
}): Promise<FreeCallBooking> => {
  const service = freeCallService(input.config);
  const end = new Date(input.start.getTime() + service.minutes * 60_000);

  return prisma.$transaction(
    async (tx) => {
      // Una llamada gratis a la vez en todo el CRM: nadie se queda con la misma hora.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('whatsapp-free-call'))`;

      const existing = await tx.whatsAppBooking.findFirst({
        where: { conversationId: input.conversationId, startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "cancelled"] } },
        select: { service: true, startsAt: true },
      });
      if (existing && isFreeCallService(existing.service, service.minutes)) {
        throw new FreeCallError("already_booked", "Ya tiene agendada su llamada gratis.");
      }

      const { from, to } = dayBounds(input.start, input.dayanaTz);
      const sameDay = await tx.whatsAppBooking.count({
        where: { startsAt: { gte: from, lt: to }, service: service.name, status: { notIn: ["CANCELLED", "cancelled"] } },
      });
      if (sameDay >= input.config.freeCall.maxPerDay) {
        throw new FreeCallError("daily_cap", "Ese día ya no hay cupos para la llamada gratis.");
      }

      let created: Awaited<ReturnType<typeof bookOnCalendar>>;
      try {
        // Por WhatsApp: sin enlace de Meet.
        created = await (calendarDeps.book ?? bookOnCalendar)({
          config: { ...input.config.booking, addMeet: false },
          timezone: input.dayanaTz,
          start: input.start,
          durationMin: service.minutes,
          service: `${service.name} (Dayana llama por WhatsApp)`,
          name: input.name,
          phone: input.phone,
          conversationId: input.conversationId,
          contactId: input.contactId,
        });
      } catch (e) {
        if (e instanceof SlotUnavailableError) throw new FreeCallError("unavailable", e.message);
        throw e;
      }

      const booking = await tx.whatsAppBooking.create({
        data: {
          conversationId: input.conversationId,
          contactId: input.contactId,
          phone: input.phone,
          name: input.name,
          service: service.name,
          startsAt: input.start,
          endsAt: created.end,
          googleAccountId: created.accountId,
          calendarEventId: created.eventId,
          meetUrl: null,
          eventUrl: created.eventUrl,
        },
      });
      // En la agenda del CRM al instante (el reloj la volvería a leer en 10 min).
      await tx.calendarAppointment.upsert({
        where: { eventId: created.eventId },
        create: {
          eventId: created.eventId,
          googleAccountId: created.accountId,
          startsAt: input.start,
          endsAt: created.end,
          title: created.title,
          name: input.name,
          phone: input.phone,
          sessionsLabel: "0/0",
          contactId: input.contactId,
          conversationId: input.conversationId,
          source: "ai",
          status: "active",
          matchState: "phone",
        },
        update: {},
      });
      return {
        bookingId: booking.id,
        startsAt: input.start,
        endsAt: end,
        title: created.title,
        label: dualZoneLabel(input.start.toISOString(), input.personTz, input.dayanaTz),
      };
    },
    { timeout: 30_000, maxWait: 15_000 }
  );
};

/** Después de agendar: el chat queda atendido y Dayana se entera (con sonido). */
export const afterFreeCallBooked = async (input: { conversationId: string; contactId: string | null; phone: string; booking: FreeCallBooking }) => {
  await resolveConversations(
    { ids: [input.conversationId], phones: [input.phone], contactIds: [input.contactId] },
    "appointment",
    null,
    { seenInboundAt: new Date() }
  ).catch((e: unknown) => console.warn("[llamada gratis] no se pudo marcar el chat como atendido", e));
  fireNotification({
    eventType: "WHATSAPP_AI_BOOKED",
    title: `Llamada gratis agendada: ${input.booking.title}`,
    body: `${input.booking.label} · la asistente la agendó sola. La llamas por WhatsApp.`,
    href: `/admin/whatsapp?conversation=${input.conversationId}`,
    entityType: "Conversation",
    entityId: input.conversationId,
    staff: "ALL",
  });
};
