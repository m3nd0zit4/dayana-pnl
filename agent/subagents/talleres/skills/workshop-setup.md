---
description: Guided flow for creating or editing a workshop edition — walks through every meaningful field via ask_question instead of guessing, and handles linking or creating its payable product.
---

Use this whenever the operator asks to create, set up, or publish a workshop/taller.

1. Ask for the title first (required) — everything else can be asked or defaulted after.
2. Ask for a short description. Offer two real ways to get one: the operator writes it,
   or you generate a compelling 1-2 sentence Spanish description yourself from the title
   (and anything else already discussed) — if chosen, write it yourself and pass it as
   cardSummary. Don't leave the field blank hoping the system default is good; it just
   repeats the title verbatim, which reads as lazy.
3. Ask about payment: call list_products and offer any active workshop-kind products as
   options. If none exist, or the operator wants a new one, offer to create one via
   create_workshop_product (title + both USD and COP prices — both are required, since
   a workshop product with no COP price would show Colombian visitors a pay button that
   fails at checkout) before continuing — or "sin pago en línea" (leave productId empty)
   as a valid choice.
4. Ask for capacity, a display date (dateLabel), and a schedule label — all optional,
   explain they're free text, not parsed dates.
5. Offer focusTopics and daySchedule as optional extras, don't force them.
6. Before creating it, ask whether to activate it now (status OPEN) or
   leave it as a draft. Call list_workshop_editions first to check whether one is
   already open, and if so warn the operator by name that confirming this will close it.
7. Call create_workshop with the full set of fields: its approval card is the
   confirmation, so do not ask «¿confirmas?» first.

After creation or an edit: tell the operator the workshop's title and whether it's open
or still a draft — that's it. If it's open, the tool result includes a real public link;
share that so they can send it right away. Never mention the internal id or slug to the
operator, they don't use it — the title is what matters to them.

For edits, use get_workshop_edition to see the current values first, then only ask
about what the operator wants to change — update_workshop still needs the current
title resent even when unrelated fields are the only thing changing.

If the operator asks about downloadable materials (PDFs, handouts) for a workshop,
use list_workshop_documents to report what's already attached — you cannot upload
one yourself; say plainly that documents are added from the admin panel (/admin →
Talleres), not from this chat.

Never invent a product link, a date, or a capacity number the operator didn't give you.

If they ask what time the taller is in another country (Japón, España, …), call
`convert_event_timezone` with `source: workshop` and the slug — never guess UTC offsets.
