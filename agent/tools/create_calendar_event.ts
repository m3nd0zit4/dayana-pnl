import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { createEvent } from "@/lib/google/calendar";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

export default defineTool({
  description:
    "Create an event on a connected Google Calendar. For a therapy session use sync_therapy_session_to_calendar instead — it keeps the CRM and the calendar pointing at each other. Adding attendees makes Google email them an invitation, so confirm the addresses with the operator first.",
  inputSchema: z.object({
    summary: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).optional(),
    location: z.string().trim().max(200).optional(),
    startIso: z.string().describe("Inicio, ISO 8601 con zona."),
    endIso: z.string().describe("Fin, ISO 8601 con zona."),
    timeZone: z
      .string()
      .optional()
      .describe("IANA, p. ej. America/Bogota. Por defecto America/Bogota."),
    attendeeEmails: z
      .array(z.string().email())
      .max(20)
      .optional()
      .describe("Google les envía invitación por correo."),
    withMeet: z
      .boolean()
      .optional()
      .describe("Crea un enlace de Google Meet para el evento."),
    accountId: z.string().optional(),
  }),
  approval: always(),
  async execute(input, ctx) {
    requireWriteStaff(ctx);

    if (new Date(input.endIso) <= new Date(input.startIso)) {
      throw new Error("El fin del evento tiene que ser posterior al inicio.");
    }

    const { account, token } = await resolveGoogleAccount(
      "CALENDAR",
      input.accountId
    );
    const event = await createEvent(token, input);

    await auditAgentWrite(ctx, {
      action: "GOOGLE_CALENDAR_EVENT_CREATED",
      entityType: "GoogleCalendarEvent",
      entityId: event.id,
      changes: {
        account: accountLabel(account),
        summary: input.summary,
        startIso: input.startIso,
        attendees: input.attendeeEmails?.length ?? 0,
      },
    });

    return {
      eventId: event.id,
      account: accountLabel(account),
      link: event.htmlLink ?? null,
      meetUrl: event.hangoutLink ?? null,
      invited: input.attendeeEmails ?? [],
    };
  },
});
