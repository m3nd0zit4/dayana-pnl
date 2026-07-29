import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getEvent, updateEvent } from "@/lib/google/calendar";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

export default defineTool({
  description:
    "Move or edit an existing Google Calendar event. Every field is replaced, so pass the full new state: read the event first with list_calendar_events if you only mean to change the time. Attendees are notified by Google.",
  inputSchema: z.object({
    eventId: z.string().min(1),
    summary: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).optional(),
    location: z.string().trim().max(200).optional(),
    startIso: z.string(),
    endIso: z.string(),
    timeZone: z.string().optional(),
    attendeeEmails: z.array(z.string().email()).max(20).optional(),
    withMeet: z.boolean().optional(),
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

    // Se lee antes para poder decir en la auditoría de qué se venía, no solo a
    // qué se va — un cambio de hora sin el "antes" es ilegible después.
    const before = await getEvent(token, input.eventId).catch(() => null);
    const event = await updateEvent(token, input.eventId, input);

    await auditAgentWrite(ctx, {
      action: "GOOGLE_CALENDAR_EVENT_UPDATED",
      entityType: "GoogleCalendarEvent",
      entityId: input.eventId,
      changes: {
        account: accountLabel(account),
        from: before
          ? { summary: before.summary, start: before.start?.dateTime }
          : null,
        to: { summary: input.summary, start: input.startIso },
      },
    });

    return {
      eventId: event.id,
      account: accountLabel(account),
      link: event.htmlLink ?? null,
      meetUrl: event.hangoutLink ?? null,
    };
  },
});
