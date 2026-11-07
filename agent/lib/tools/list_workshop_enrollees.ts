import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import type { DisplayBlock } from "@/agent/lib/display";
import { getWorkshopEditionBySlug } from "@/lib/crm/workshop-editions";
import { listWorkshopInterests } from "@/lib/crm/workshop-interests";
import { listWorkshopEnrollments, workshopEnrollmentStats } from "@/lib/crm/workshop-panel";

const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default defineTool({
  description:
    "List the people of ONE workshop edition: the enrolled (paid: ACTIVE/COMPLETED, with their reminder state) and/or the interested («Interesadas»: people who asked about the workshop on WhatsApp or registered on the workshop page, with follow-up status, whether they paid, next call and whether the AI already wrote to them). Interested people are NOT enrolled and have no access. Get the slug from list_workshop_editions.",
  inputSchema: z.object({
    slug: z.string().min(1).describe("Workshop edition slug"),
    include: z.enum(["enrolled", "interested", "both"]).optional().describe("Default both"),
    q: z.string().trim().max(80).optional().describe("Name, email or phone (enrolled only)"),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows per list, default 50"),
  }),
  async execute({ slug, include = "both", q, limit = 50 }, ctx) {
    requireStaff(ctx);
    const edition = await getWorkshopEditionBySlug(slug);
    if (!edition) return { found: false as const };

    const wantEnrolled = include !== "interested";
    const wantInterested = include !== "enrolled";
    const [stats, enrolled, interested] = await Promise.all([
      wantEnrolled ? workshopEnrollmentStats(edition.id) : null,
      wantEnrolled ? listWorkshopEnrollments(edition.id, { take: limit, q }) : [],
      wantInterested ? listWorkshopInterests(edition.id) : [],
    ]);

    const enrolledRows = enrolled.map((e) => ({
      enrollmentId: e.id,
      name: e.name,
      phone: e.phoneE164,
      email: e.email,
      status: e.status,
      paidAt: e.paidAtIso,
      reminders: {
        email24h: Boolean(e.reminder24hSentAt),
        email1h: Boolean(e.reminder1hSentAt),
        whatsapp24h: Boolean(e.reminder24hWaSentAt),
        whatsapp1h: Boolean(e.reminder1hWaSentAt),
        whatsappError: e.waReminderError ?? e.waReminder1hError ?? null,
      },
      ref: { type: "contact" as const, id: e.contactId, href: `/admin/contacts/${e.contactId}` },
    }));
    const interestedRows = interested.slice(0, limit).map((i) => ({
      id: i.id,
      name: i.name,
      phone: i.phone,
      status: i.status,
      asks: i.asks,
      firstMessage: i.pageOnly ? null : i.firstMessage.slice(0, 200),
      registeredOnPage: Boolean(i.registration),
      firstAskedAt: i.firstAskedAt.toISOString(),
      lastAskedAt: i.lastAskedAt.toISOString(),
      paid: i.paid,
      nextCallAt: i.nextCallAt?.toISOString() ?? null,
      aiWroteAt: i.offeredAt?.toISOString() ?? null,
      ref: {
        type: "conversation" as const,
        id: i.conversationId,
        href: `/admin/whatsapp?conversation=${i.conversationId}`,
      },
    }));

    const display: DisplayBlock[] = [];
    if (enrolledRows.length) {
      display.push({
        kind: "table",
        title: "Inscritas",
        columns: ["Persona", "Teléfono", "Pagó", "Recordatorio WA 24 h"],
        rows: enrolledRows.map((r) => [r.name, r.phone ?? "", day(r.paidAt), r.reminders.whatsapp24h ? "Sí" : "No"]),
        ...(stats && stats.total > enrolledRows.length ? { more: stats.total - enrolledRows.length } : {}),
      });
    }
    if (interestedRows.length) {
      display.push({
        kind: "table",
        title: "Interesadas",
        columns: ["Persona", "Seguimiento", "Pagó", "Última vez"],
        rows: interestedRows.map((r) => [r.name ?? r.phone, r.status, r.paid ? "Sí" : "No", day(r.lastAskedAt)]),
        ...(interested.length > interestedRows.length ? { more: interested.length - interestedRows.length } : {}),
      });
    }

    return {
      found: true as const,
      edition: { id: edition.id, slug: edition.slug, title: edition.title, status: edition.status },
      ...(stats ? { enrolledTotal: stats.total } : {}),
      ...(wantInterested ? { interestedTotal: interested.length } : {}),
      enrolled: enrolledRows,
      interested: interestedRows,
      display,
    };
  },
});
