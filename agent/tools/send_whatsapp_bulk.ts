import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { requireWriteStaff, getCallerStaff } from "@/agent/lib/guard";
import { prisma } from "@/lib/db";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { freeEventPresets, resolvePresetVars, workshopPresets } from "@/lib/crm/whatsapp-presets";
import { createSend, previewSend, processNextBatch } from "@/lib/crm/whatsapp-sends";

export default defineTool({
  description:
    "Send a WhatsApp message to many people at once: the registrants of a free event, the enrollees of a workshop edition, or a list of contactIds. First call it with dryRun=true to get the preview (how many go free, how many by paid template and the estimated cost, how many can't be reached) and show it to Dayana; then call again with dryRun=false after she approves. message = 'enlace' | 'recordatorio' | 'material' | 'invitacion' | 'libre' (libre uses `text`).",
  inputSchema: z.object({
    audience: z.enum(["event_registrants", "workshop_enrollees", "contacts"]),
    eventId: z.string().optional().describe("Evento gratuito; sin él, el evento actual."),
    workshopSlug: z.string().optional(),
    contactIds: z.array(z.string()).max(2000).optional(),
    message: z.enum(["enlace", "recordatorio", "material", "invitacion", "libre"]),
    text: z.string().max(4000).optional().describe("Texto para message=libre (o para cambiar el texto listo)."),
    dryRun: z.boolean(),
  }),
  approval: always(),
  async execute(input, ctx) {
    requireWriteStaff(ctx);
    const { staffId } = getCallerStaff(ctx);
    const tz = await getOperationalTimezone();

    let contactIds: string[] = [];
    let presets = freeEventPresets(null, tz);
    let title = "Envío por WhatsApp";
    let kind: "evento" | "taller" | "libre" = "libre";

    if (input.audience === "event_registrants") {
      const event = input.eventId
        ? await prisma.freeWebinar.findUnique({ where: { id: input.eventId } })
        : await prisma.freeWebinar.findFirst({ where: { isActive: true }, orderBy: { startsAt: "desc" } });
      if (!event) throw new Error("No encontré el evento.");
      contactIds = (
        await prisma.webinarRegistration.findMany({ where: { webinarId: event.id }, select: { contactId: true } })
      ).map((r) => r.contactId);
      presets = freeEventPresets(event, tz);
      title = `Evento: ${event.headline}`;
      kind = "evento";
    } else if (input.audience === "workshop_enrollees") {
      const w = await prisma.workshopEdition.findUnique({
        where: { slug: input.workshopSlug ?? "" },
        select: {
          title: true,
          slug: true,
          startsAt: true,
          dateLabel: true,
          meetingUrl: true,
          enrollments: { select: { contactId: true } },
        },
      });
      if (!w) throw new Error("No encontré el taller.");
      contactIds = [...new Set(w.enrollments.map((e) => e.contactId))];
      presets = workshopPresets(w, tz);
      title = `Taller: ${w.title}`;
      kind = "taller";
    } else {
      contactIds = input.contactIds ?? [];
    }

    const presetId = input.message === "enlace" ? "invitacion" : input.message;
    const preset = presets.find((p) => p.id === presetId) ?? presets.find((p) => p.id === "libre")!;
    const text = input.text?.trim() || preset.text;
    const vars = resolvePresetVars(preset.vars, text);

    if (input.dryRun) {
      const preview = await previewSend({ contactIds, templateKey: preset.templateKey });
      return { dryRun: true, people: contactIds.length, text, template: preview.templateInfo, preview };
    }

    const created = await createSend({
      title: `${title} · ${preset.label}`,
      kind,
      text,
      templateKey: preset.templateKey,
      vars,
      contactIds,
      staffId,
    });
    let progress = await processNextBatch(created.id, staffId);
    for (let i = 0; i < 200 && progress.pending > 0; i++) {
      progress = await processNextBatch(created.id, staffId);
    }
    return { done: progress.pending === 0, ...progress, detail: `/admin/whatsapp/envios?id=${created.id}` };
  },
});
