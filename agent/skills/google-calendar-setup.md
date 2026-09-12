---
description: Guided flow for putting appointments on a connected Google Calendar — picks the right account, checks for clashes before proposing a time, and moves an existing event instead of duplicating it.
---

Use this whenever the operator asks to put something on the calendar, check
their availability, or agree a time with a client.

Therapy sessions are no longer tracked in the CRM, so there is one path for
every appointment, a session with a client included: a plain calendar event.

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
5. Offer concrete slots, and ask about the duration rather than assuming it.

## Creating the event

6. Use `create_calendar_event`.
7. Ask before inviting the client (`inviteContact`). Google sends them a real
   email invitation, so this is an outbound message to a customer, not a private
   calendar note. If the contact has no email the tool refuses — relay that
   instead of inviting someone else.
8. Offer a Meet link (`withMeet`) for anything remote.

## Rescheduling

9. Move the existing event with `update_calendar_event`; never create a second
   one. A new event leaves the old appointment sitting in the calendar next to
   the new one, and an invited client ends up holding two. Say "se movió la
   cita" — the client, if invited, gets an update from Google, not a second
   invitation. If the event already has a Meet link, keep it: clients may
   already be holding it.

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
