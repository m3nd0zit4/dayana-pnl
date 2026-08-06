---
description: Convert webinar/taller/sesión times to a visitor country (Japón, España, …) with exact local clock — never guess UTC offsets.
---

Use this whenever the operator asks what time an event is **in another country or city** (Japón, España, México, Nueva York, etc.), or “qué hora sería para alguien en…”.

## Tool

Call `convert_event_timezone` — do **not** do mental arithmetic on UTC offsets.

| Pregunta típica | `source` | Extra |
|---|---|---|
| Webinar gratuito ¿a qué hora en Japón? | `free_webinar` | — |
| Este taller ¿hora en España? | `workshop` | `workshopSlug` (from `list_workshop_editions` / context) |
| Sesión de X ¿hora en Perú? | `therapy_session` | `therapySessionId` |
| “Si fuera el domingo a las 7pm Colombia…” | `instant` | `startsAtIso` in UTC (convert Colombia wall time with care — prefer loading the real event) |

`targets`: one or more of `{ countryName: "Japón" }`, `{ countryIso: "ES" }`, or `{ timeZone: "Asia/Tokyo" }`. You can pass several in one call.

For workshops with franjas, set `includeDaySchedule: true` so each slot is converted too.

## How to answer

1. Load the real event (or use the tool’s built-in loaders) — never invent `startsAt`.
2. Call the tool; quote **`speakEs`** (or `localDate` + `timeWithPlace`) verbatim.
3. If `hasTime` is false, say the **date** in that country and that the clock time is still TBD.
4. If the tool returns `ok: false`, explain the error (missing slug, no schedule, unknown country) — don’t invent a time.

## Never

- Guess “Japón es UTC+9 así que…” without the tool.
- Confuse CRM timezone (where staff entered the time) with the visitor’s local time.
- Mix up date-only webinars with timed ones.
