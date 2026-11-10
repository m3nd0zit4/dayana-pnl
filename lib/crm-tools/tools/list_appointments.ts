import { defineTool } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { requireStaff } from "@/lib/crm-tools/guard";
import type { DisplayBlock } from "@/lib/crm-tools/display";
import { prisma } from "@/lib/db";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** «GMT-05:00» → «-05:00» para `timeZone` en ese instante. */
const zoneOffset = (timeZone: string, at: Date) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const offset = name?.replace("GMT", "") ?? "";
  return offset === "" ? "Z" : offset;
};

/** El inicio de ese día en la zona del CRM. */
const dayStart = (key: string, timeZone: string) => {
  const guess = new Date(`${key}T12:00:00Z`);
  return new Date(`${key}T00:00:00${zoneOffset(timeZone, guess)}`);
};

const localLabel = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);

export default defineTool({
  description:
    "List appointments from the CRM's copy of Dayana's calendar: free 15-min calls and paid sessions linked to a person (CalendarAppointment: source ai|manual, call outcome, reminders, no-show, clash), plus the bookings the WhatsApp AI made (WhatsAppBooking). Dates are days in the CRM timezone (YYYY-MM-DD, `to` inclusive); default from yesterday to 14 days ahead. For the live Google Calendar use list_calendar_events.",
  inputSchema: z.object({
    from: z.string().regex(DATE).optional(),
    to: z.string().regex(DATE).optional(),
    kind: z.enum(["appointments", "bookings", "both"]).optional().describe("Default both"),
    conversationId: z.string().min(1).optional(),
    contactId: z.string().min(1).optional(),
    includeCancelled: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50 per list"),
  }),
  async execute({ from, to, kind = "both", conversationId, contactId, includeCancelled, limit = 50 }, ctx) {
    requireStaff(ctx);
    const timeZone = await getOperationalTimezone();
    const start = from ? dayStart(from, timeZone) : new Date(Date.now() - 24 * 3600_000);
    const end = to
      ? new Date(dayStart(to, timeZone).getTime() + 24 * 3600_000)
      : new Date(Date.now() + 14 * 24 * 3600_000);
    const range = { gte: start, lt: end };

    const [appointments, bookings] = await Promise.all([
      kind === "bookings"
        ? []
        : prisma.calendarAppointment.findMany({
            where: {
              startsAt: range,
              ...(includeCancelled ? {} : { status: "active" }),
              ...(conversationId ? { conversationId } : {}),
              ...(contactId ? { contactId } : {}),
            },
            orderBy: { startsAt: "asc" },
            take: limit,
          }),
      kind === "appointments"
        ? []
        : prisma.whatsAppBooking.findMany({
            where: {
              startsAt: range,
              ...(includeCancelled ? {} : { status: "BOOKED" }),
              ...(conversationId ? { conversationId } : {}),
              ...(contactId ? { contactId } : {}),
            },
            orderBy: { startsAt: "asc" },
            take: limit,
          }),
    ]);

    const appointmentRows = appointments.map((a) => ({
      id: a.id,
      title: a.title,
      person: a.name,
      phone: a.phone,
      startsAt: a.startsAt.toISOString(),
      local: localLabel(a.startsAt, timeZone),
      endsAt: a.endsAt.toISOString(),
      freeCall: !a.meetUrl,
      sessions: a.sessionsLabel,
      source: a.source,
      status: a.status,
      matchState: a.matchState,
      callOutcome: a.callOutcome,
      reminders: {
        day: a.reminderSentAt ? "sent" : a.reminderError ? `error: ${a.reminderError}` : null,
        soon: a.reminderSoonSentAt
          ? a.reminderSoonSkipped
            ? `skipped: ${a.reminderSoonSkipped}`
            : "sent"
          : a.reminderSoonError
            ? `error: ${a.reminderSoonError}`
            : null,
      },
      noShow: a.noShowState,
      clashWith: a.clashWith ?? null,
      ...(a.conversationId
        ? {
            ref: {
              type: "conversation" as const,
              id: a.conversationId,
              href: `/admin/whatsapp?conversation=${a.conversationId}`,
            },
          }
        : {}),
      ...(a.contactId
        ? { contactRef: { type: "contact" as const, id: a.contactId, href: `/admin/contacts/${a.contactId}` } }
        : {}),
    }));
    const bookingRows = bookings.map((b) => ({
      id: b.id,
      person: b.name,
      phone: b.phone,
      service: b.service,
      startsAt: b.startsAt.toISOString(),
      local: localLabel(b.startsAt, timeZone),
      status: b.status,
      meetUrl: b.meetUrl,
      bookedAt: b.createdAt.toISOString(),
      ref: {
        type: "conversation" as const,
        id: b.conversationId,
        href: `/admin/whatsapp?conversation=${b.conversationId}`,
      },
    }));

    const display: DisplayBlock[] = appointmentRows.length
      ? [
          {
            kind: "table",
            title: "Citas",
            columns: ["Cuándo", "Persona", "Tipo", "Resultado"],
            rows: appointmentRows.map((a) => [
              a.local,
              a.person ?? a.title,
              a.freeCall ? "Llamada gratis" : `Sesión${a.sessions ? ` ${a.sessions}` : ""}`,
              a.callOutcome ?? "",
            ]),
          },
        ]
      : [];

    return {
      timeZone,
      from: start.toISOString(),
      to: end.toISOString(),
      appointments: appointmentRows,
      bookings: bookingRows,
      display,
    };
  },
});
