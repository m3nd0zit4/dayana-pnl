---
description: Guided flow for putting therapy sessions and one-off appointments on a connected Google Calendar — picks the right account, checks for clashes before proposing a time, and keeps the CRM session and the calendar event pointing at each other.
---

Use this whenever the operator asks to put something on the calendar, check
their availability, or agree a time with a client.

## Before anything else: which calendar

1. If more than one Google account has Calendar connected, ask which one **before**
   reading or writing. `list_google_accounts` shows them with their `accountId`.
   Do not default to the first one; a personal and a work calendar look identical
   in a tool result and only the operator knows which they meant.
2. If no account has Calendar, stop. Say it's enabled in `/admin/ajustes/google`
   and do not try to work around it by writing the time into a note or a message.

## Agreeing a time

3. Always call `list_calendar_events` over the day (or the week, if they're
   flexible) before proposing anything. Proposing a slot that turns out to be
   taken costs the operator a second conversation with the client.
4. Read back what's already there in plain language — "el martes tienes algo de
   9 a 10 y otra cosa a las 3" — rather than dumping the event list.
5. Offer concrete slots. Ask, don't assume, about duration when it isn't a
   therapy session; therapy sessions already carry their own `durationMinutes`.

## Therapy or something else?

Not every appointment is a therapy session — don't default to the therapy path
just because the request came through the CRM. Use it only when:

- the operator's own words say so ("sesión", "terapia", names a package), or
- the appointment is for a contact who already has an active `TherapyPackage`
  and nothing in the request suggests otherwise.

Anything else — a call, a meeting, an errand, "bloquéame el jueves a las 3" — is
a plain appointment: use `create_calendar_event` directly and skip the whole
"Therapy sessions" section below, including `schedule_therapy_session`. Don't
create or touch a `TherapySession` row for something that isn't one.

If it's genuinely unclear which this is, ask outright before scheduling
anything — "¿esto es una sesión de terapia o una cita aparte?" — rather than
guessing either way.

## Therapy sessions

Only follow this section once the branch above has confirmed it's actually a
therapy session.

6. The session must already have a date. If it doesn't, schedule it first with
   `schedule_therapy_session`, then sync — `sync_therapy_session_to_calendar`
   refuses a session with no date, and that refusal is correct, not something to
   route around.
7. Use `sync_therapy_session_to_calendar`, never `create_calendar_event`, for a
   session. Only the sync tool stores the event id on the session, and without it
   the next reschedule leaves the old appointment sitting in the calendar next to
   the new one.
8. Ask before inviting the client (`inviteContact`). Google sends them a real
   email invitation, so this is an outbound message to a customer, not a private
   calendar note. If the contact has no email the tool refuses — relay that
   instead of inviting someone else.
9. Offer a Meet link (`withMeet`) for anything remote. If the session already has
   a `meetUrl` the tool keeps it: don't offer to "regenerate" it, because clients
   may already be holding the old link.

## Rescheduling

10. Re-run `sync_therapy_session_to_calendar` on the same session after changing
    its date. That moves the existing event. Say "se movió la cita" — the client,
    if invited, gets an update from Google, not a second invitation.

## Always

Confirm the full plan in one plain sentence before the write tool's approval
prompt appears — who, when, how long, on which calendar, and whether the client
gets invited. Keep it to one line with no manual line breaks: escaped newlines
inside tool-call arguments render as literal "\n" in the panel on some models.

Never invent an availability you didn't read from the calendar, and never tell
the operator a client was notified unless the tool result says they were
invited.

Report events by title and time only — never paste a raw `eventId` or
`accountId` into your reply. See "Cuentas de Google" in the main instructions.
