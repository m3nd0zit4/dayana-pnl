import { defineTool } from "eve/tools";
import { z } from "zod";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { countWebinarRegistrations } from "@/lib/crm/webinar-registrations";
import { siteUrl } from "@/lib/notifications/config";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Get the CURRENT free webinar edition (headline, schedule in CRM operational timezone, active flag, meet link, learn items, FAQ, registration count). The live edition is always the one at /webinar-gratuito; past editions are archived into a CRM-only history that this tool does not read. `endedAt` set means it already happened: registrations and reminders are closed until someone archives it and sets a new date.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const webinar = await ensureFreeWebinar();
    const registrations = await countWebinarRegistrations(webinar.id);
    return {
      webinar: {
        registrations,
        id: webinar.id,
        isActive: webinar.isActive,
        headline: webinar.headline,
        subheadline: webinar.subheadline,
        body: webinar.body,
        startsAtIso: webinar.startsAtIso,
        startsAtDate: webinar.startsAtDateKey,
        startsAtTime: webinar.startsAtTimeHm,
        startsAtHasTime: webinar.startsAtHasTime,
        operationalTimezone: webinar.operationalTimezone,
        meetUrl: webinar.meetUrl,
        endedAt: webinar.endedAt,
        archivedAt: webinar.archivedAt,
        videoStatus: webinar.videoStatus,
        hasVideo: webinar.videoStatus === "READY",
        learnSectionTitle: webinar.learnSectionTitle,
        learnItems: webinar.learnItems,
        faq: webinar.faq,
        ctaLabel: webinar.ctaLabel,
        formTitle: webinar.formTitle,
        metaTitle: webinar.metaTitle,
        metaDescription: webinar.metaDescription,
        link: webinar.isActive && webinar.startsAt ? `${siteUrl()}/webinar-gratuito` : null,
        publishReady: Boolean(
          webinar.headline.trim() &&
            webinar.subheadline?.trim() &&
            webinar.startsAt &&
            webinar.learnItems.length > 0
        ),
      },
    };
  },
});
