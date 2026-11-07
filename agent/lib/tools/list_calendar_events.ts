import { defineTool } from "eve/tools";
import { z } from "zod";
import { listEvents } from "@/lib/google/calendar";
import { requireStaff } from "@/agent/lib/guard";
import { accountLabel, resolveGoogleAccount } from "@/agent/lib/google";

export default defineTool({
  description:
    "Read events from a connected Google Calendar over a date range. Use it to answer 'what do I have this week', and to check for a clash BEFORE scheduling a therapy session. Read-only. If several Google accounts have Calendar connected it will tell you so — ask the operator which one and pass accountId.",
  inputSchema: z.object({
    timeMin: z
      .string()
      .describe("Inicio del rango, ISO 8601 con zona, p. ej. 2026-07-28T00:00:00-05:00"),
    timeMax: z.string().describe("Fin del rango, ISO 8601 con zona."),
    query: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Filtro de texto libre sobre título, descripción y asistentes."),
    maxResults: z.number().int().min(1).max(100).optional(),
    accountId: z
      .string()
      .optional()
      .describe("Cuenta de Google a consultar. Omítelo si solo hay una."),
  }),
  async execute({ timeMin, timeMax, query, maxResults, accountId }, ctx) {
    requireStaff(ctx);

    const { account, token } = await resolveGoogleAccount("CALENDAR", accountId);
    const events = await listEvents(token, {
      timeMin,
      timeMax,
      query,
      maxResults,
    });

    return {
      account: accountLabel(account),
      count: events.length,
      events: events.map((e) => ({
        eventId: e.id,
        title: e.summary ?? "(sin título)",
        // Un evento de día completo trae `date` y no `dateTime`; mezclarlos
        // haría que se leyera como si empezara a medianoche.
        start: e.start?.dateTime ?? e.start?.date ?? null,
        end: e.end?.dateTime ?? e.end?.date ?? null,
        allDay: !e.start?.dateTime,
        location: e.location ?? null,
        meetUrl: e.hangoutLink ?? null,
        link: e.htmlLink ?? null,
        attendees: e.attendees?.map((a) => a.email).filter(Boolean) ?? [],
      })),
    };
  },
});
