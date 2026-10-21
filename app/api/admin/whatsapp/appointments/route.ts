import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { confirmAppointmentPerson, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { changeCallOutcome, markCallOutcome } from "@/lib/crm/whatsapp-agent/call-outcome";
import { canChangeOutcome, needsOutcomeMark } from "@/lib/crm/whatsapp-agent/call-outcome-rules";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";
import { isFreeCallAppointment } from "@/lib/crm/whatsapp-agent/event-title";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Próximas citas (14 días), las de los últimos 2 días (para ver si se hizo la llamada) y las que falta saber quién es. */
export const GET = withStaff("read", async () => {
  const now = new Date();
  const rows = await prisma.calendarAppointment.findMany({
    where: { status: "active", startsAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: new Date(now.getTime() + 14 * 24 * 3600_000) } },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  // El servicio de la reserva (si la agendó la IA) dice si es la llamada gratis.
  const bookings = await prisma.whatsAppBooking.findMany({
    where: { calendarEventId: { in: rows.map((a) => a.eventId) } },
    select: { calendarEventId: true, service: true },
  });
  return NextResponse.json({
    items: rows.map((a) => {
      const freeCall = isFreeCallAppointment({ ...a, bookingService: bookings.find((b) => b.calendarEventId === a.eventId)?.service ?? null });
      return {
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        title: a.title,
        name: a.name,
        phone: a.phone,
        sessionsLabel: a.sessionsLabel,
        conversationId: a.conversationId,
        contactId: a.contactId,
        matchState: a.matchState,
        candidates: a.candidates,
        confirmedAt: a.confirmedAt?.toISOString() ?? null,
        reminderSentAt: a.reminderSentAt?.toISOString() ?? null,
        reminderError: a.reminderError,
        reminderSoonSentAt: a.reminderSoonSentAt?.toISOString() ?? null,
        reminderSoonError: a.reminderSoonError,
        reminderSoonSkipped: a.reminderSoonSkipped,
        endsAt: a.endsAt.toISOString(),
        callOutcome: a.callOutcome,
        callOutcomeReason: a.callOutcomeReason,
        outcomeCheckAt: a.outcomeCheckAt?.toISOString() ?? null,
        rescheduleSentAt: a.rescheduleSentAt?.toISOString() ?? null,
        /** Otro evento del calendario cae encima (solo llamadas gratis que no han pasado). */
        clashWith: a.clashEventId && a.startsAt.getTime() > now.getTime() ? (a.clashWith as { title: string; startsAt: string; endsAt: string } | null) : null,
        freeCall,
        /** Llamada gratis que ya pasó sin saber cómo terminó: «Hablaron» / «No contestó». */
        canMarkOutcome: freeCall && Boolean(a.conversationId) && needsOutcomeMark(a, now),
        /** Ya marcada («Hablaron» / «No contestó»): Dayana la puede corregir. */
        canChangeOutcome: freeCall && Boolean(a.conversationId) && canChangeOutcome(a, now),
      };
    }),
  });
});

const schema = z.discriminatedUnion("action", [
  /** Leer el calendario ahora (sin esperar al reloj). */
  z.object({ action: z.literal("sync") }),
  /** Dayana eligió quién es o escribió el número. */
  z.object({ action: z.literal("assign"), appointmentId: z.string(), phone: z.string().min(8).max(20) }),
  /**
   * Dayana dice cómo terminó la llamada gratis («Hablaron» / «No contestó»):
   * WhatsApp no avisa de las llamadas del celular. «No contestó» le manda
   * horas para reagendar.
   */
  z.object({
    action: z.literal("outcome"),
    appointmentId: z.string().min(1),
    outcome: z.enum(["answered", "no_answer"]),
    /** «No contestó» sin mensaje (ya le escribió ella). Por defecto, sí. */
    sendHours: z.boolean().optional(),
  }),
  /**
   * Corregir una llamada ya marcada (tocó el botón equivocado o el chat lo
   * dedujo mal). A «No contestó», con `sendHours` le manda horas si no se le
   * mandaron ya.
   */
  z.object({
    action: z.literal("change_outcome"),
    appointmentId: z.string().min(1),
    outcome: z.enum(["answered", "no_answer"]),
    sendHours: z.boolean(),
  }),
]);

const OUTCOME_STATUS: Record<string, number> = {
  not_found: 404,
  not_free: 409,
  not_yet: 409,
  already_decided: 409,
  not_changeable: 409,
  same: 409,
  changed_meanwhile: 409,
};

/** Con el resultado nuevo, el estado de la persona (tuvo la llamada / no contestó) se recalcula ya. */
const refreshSegmentOf = async (appointmentId: string) => {
  const appt = await prisma.calendarAppointment.findUnique({ where: { id: appointmentId }, select: { conversationId: true } });
  if (appt?.conversationId) await computeSegment(appt.conversationId).catch(() => null);
};

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  try {
    if (parsed.data.action === "sync") return NextResponse.json(await syncAppointments());
    if (parsed.data.action === "outcome") {
      const r = await markCallOutcome({
        appointmentId: parsed.data.appointmentId,
        outcome: parsed.data.outcome,
        sendHours: parsed.data.sendHours,
        staffUserId: staff.id,
      });
      if (r.ok) await refreshSegmentOf(parsed.data.appointmentId);
      return r.ok ? NextResponse.json(r) : apiError(r.error, OUTCOME_STATUS[r.error] ?? 400);
    }
    if (parsed.data.action === "change_outcome") {
      const r = await changeCallOutcome({
        appointmentId: parsed.data.appointmentId,
        outcome: parsed.data.outcome,
        sendHours: parsed.data.sendHours,
        staffUserId: staff.id,
      });
      if (r.ok) await refreshSegmentOf(parsed.data.appointmentId);
      return r.ok ? NextResponse.json(r) : apiError(r.error, OUTCOME_STATUS[r.error] ?? 400);
    }
    const digits = parsed.data.phone.replace(/\D/g, "");
    if (digits.length < 10) return apiError("Escribe el número con código de país (ej. +57 300…).", 400);
    await confirmAppointmentPerson({ appointmentId: parsed.data.appointmentId, phoneE164: `+${digits}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "error", 400);
  }
});
