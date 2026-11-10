import { defineTool } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { requireStaff } from "@/lib/crm-tools/guard";
import type { DisplayBlock } from "@/lib/crm-tools/display";
import { listFreeEventPeople, listFreeEvents } from "@/lib/crm/free-events";
import { getCurrentFreeEvent } from "@/lib/crm/free-webinar";
import { shownPhone } from "@/lib/crm-tools/phone";

export default defineTool({
  description:
    "List who registered for a free event (webinar): one row per person with every free event they signed up for, so repeat attendees show. Without eventId it uses the CURRENT event (the published one, else the next or the last). Also returns the recent events with their registration counts, so you can pick another eventId. Use get_free_webinar for the event's own details.",
  inputSchema: z.object({
    eventId: z.string().min(1).optional().describe("A free event id from `events`; default the current one"),
    allEvents: z.boolean().optional().describe("People of every free event, not one"),
    q: z.string().trim().max(80).optional().describe("Name, email or phone"),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(10).max(100).optional().describe("Default 30"),
  }),
  async execute({ eventId, allEvents, q, page, pageSize = 30 }, ctx) {
    requireStaff(ctx);
    const [events, current] = await Promise.all([listFreeEvents(), eventId || allEvents ? null : getCurrentFreeEvent()]);
    const targetId = allEvents ? null : (eventId ?? current?.id ?? null);
    if (!allEvents && !targetId) return { found: false as const, notice: "Todavía no hay ningún evento gratuito." };
    const target = targetId ? events.find((e) => e.id === targetId) : null;
    if (targetId && !target) return { found: false as const, notice: "Ese evento no existe." };

    const result = await listFreeEventPeople({ eventId: targetId, q, page, pageSize });
    const people = result.people.map((p) => ({
      name: p.name,
      phone: shownPhone(p.phoneE164),
      email: p.email,
      lastRegisteredAt: p.lastRegisteredAt.toISOString(),
      eventsCount: p.events.length,
      events: p.events.slice(0, 5).map((e) => e.headline),
      ref: { type: "contact" as const, id: p.contactId, href: `/admin/contacts/${p.contactId}` },
    }));

    const display: DisplayBlock[] = people.length
      ? [
          {
            kind: "table",
            title: target ? `Inscritas: ${target.headline}` : "Inscritas a eventos gratuitos",
            columns: ["Persona", "Teléfono", "Se inscribió", "Eventos"],
            rows: people.map((p) => [p.name, p.phone ?? "", p.lastRegisteredAt.slice(0, 10), p.eventsCount]),
            ...(result.total > result.page * result.pageSize
              ? { more: result.total - result.page * result.pageSize }
              : {}),
          },
        ]
      : [];

    return {
      found: true as const,
      event: target
        ? {
            id: target.id,
            headline: target.headline,
            status: target.status,
            startsAt: target.startsAt?.toISOString() ?? null,
            registrations: target.registrations,
            ref: { type: "free_event" as const, id: target.id, href: `/admin/eventos/${target.id}` },
          }
        : null,
      total: result.total,
      page: result.page,
      hasMore: result.total > result.page * result.pageSize,
      people,
      events: events.slice(0, 10).map((e) => ({
        id: e.id,
        headline: e.headline,
        status: e.status,
        startsAt: e.startsAt?.toISOString() ?? null,
        registrations: e.registrations,
        isCurrent: e.isCurrent,
      })),
      display,
    };
  },
});
