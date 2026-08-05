---
description: Guided flow for setting up, publishing, editing, or taking down the free webinar landing (/webinar-gratuito) — date/time in CRM timezone America/Bogota, never free-text schedule labels.
---

Use this whenever the operator asks about the webinar gratuito, the free webinar page, or registrations tagged webinar-gratuito.

1. Call `get_free_webinar` first to see current state (active?, schedule?, copy).
2. Ask for the headline (required to publish) and a short subheadline.
3. Ask for the date **in Colombia / America/Bogota**. Time (`startsAtTime`) is optional until confirmed — pass only `startsAtDate` to leave the public page date-only. Never store free-text like “Fecha por confirmar”. When a time exists, the public page shows each visitor’s local clock with a place label (ej. “hora Colombia”).
4. Ask for learn items as a structured list (array of short strings) and optionally FAQ as `{q,a}` objects — never ask the operator to format multiline text blocks. Video uploads are only from the admin panel (`/admin/webinar`), not from this chat; you can clear a video with `clearVideo: true`.
5. Before publishing, confirm in one plain Spanish sentence (plus the tool approval gate) that they want it live. Publishing fails if headline, subheadline, date, or learn items are missing — report the blockers, don’t invent values.
6. After publish, share the public link from the tool result (`/webinar-gratuito`) so they can post it. Mention that `/enlaces` shows the CTA only while active.

Edits: get first, then only change what they ask for.

Taking it down / “eliminar”:
- Hide only → `deactivate_free_webinar` with `mode=deactivate` (keeps schedule).
- Hide and clear date → `mode=clear_schedule`.
- Start over with default copy → `mode=reset`.

Never invent a date, invent a time, or mark it active without the required fields.
