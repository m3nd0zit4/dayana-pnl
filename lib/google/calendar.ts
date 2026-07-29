import { throwGoogleApiError } from "./api-error";

/**
 * Google Calendar, la parte que usamos.
 *
 * A mano y no con `googleapis`: son cuatro endpoints y ese paquete pesa
 * decenas de megas, lo que en una función serverless se paga en arranque en
 * frío cada vez.
 */

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

const request = async <T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const res = await fetch(`${CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!res.ok) await throwGoogleApiError("calendar", res);

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
};

export type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; responseStatus?: string }[];
};

export const listEvents = async (
  token: string,
  input: {
    calendarId?: string;
    timeMin: string;
    timeMax: string;
    maxResults?: number;
    query?: string;
  }
): Promise<CalendarEvent[]> => {
  const params = new URLSearchParams({
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    // Sin esto los eventos periódicos vuelven como una sola regla y no como las
    // ocurrencias concretas, que es lo que el operador espera ver.
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(input.maxResults ?? 50),
  });
  if (input.query) params.set("q", input.query);

  const data = await request<{ items?: CalendarEvent[] }>(
    token,
    `/calendars/${encodeURIComponent(input.calendarId ?? "primary")}/events?${params}`
  );
  return data.items ?? [];
};

export const getEvent = (
  token: string,
  eventId: string,
  calendarId = "primary"
): Promise<CalendarEvent> =>
  request(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  );

export type EventInput = {
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  timeZone?: string;
  attendeeEmails?: string[];
  /** Pide a Google que cree un Meet y lo devuelva en `hangoutLink`. */
  withMeet?: boolean;
};

const toEventBody = (input: EventInput) => ({
  summary: input.summary,
  ...(input.description ? { description: input.description } : {}),
  ...(input.location ? { location: input.location } : {}),
  start: { dateTime: input.startIso, timeZone: input.timeZone ?? "America/Bogota" },
  end: { dateTime: input.endIso, timeZone: input.timeZone ?? "America/Bogota" },
  ...(input.attendeeEmails?.length
    ? { attendees: input.attendeeEmails.map((email) => ({ email })) }
    : {}),
  ...(input.withMeet
    ? {
        conferenceData: {
          createRequest: {
            // Google exige un id único por petición; repetirlo devuelve la
            // conferencia anterior en vez de crear una nueva.
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }
    : {}),
});

export const createEvent = (
  token: string,
  input: EventInput & { calendarId?: string }
): Promise<CalendarEvent> => {
  const params = new URLSearchParams();
  if (input.withMeet) params.set("conferenceDataVersion", "1");

  return request(
    token,
    `/calendars/${encodeURIComponent(input.calendarId ?? "primary")}/events?${params}`,
    { method: "POST", body: JSON.stringify(toEventBody(input)) }
  );
};

export const updateEvent = (
  token: string,
  eventId: string,
  input: EventInput & { calendarId?: string }
): Promise<CalendarEvent> => {
  const params = new URLSearchParams();
  if (input.withMeet) params.set("conferenceDataVersion", "1");

  return request(
    token,
    `/calendars/${encodeURIComponent(input.calendarId ?? "primary")}/events/${encodeURIComponent(eventId)}?${params}`,
    { method: "PATCH", body: JSON.stringify(toEventBody(input)) }
  );
};
