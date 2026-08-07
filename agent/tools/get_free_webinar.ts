import { defineTool } from "eve/tools";
import { z } from "zod";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { countWebinarRegistrations } from "@/lib/crm/webinar-registrations";
import { siteUrl } from "@/lib/notifications/config";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Get the free webinar landing config (headline, schedule in CRM operational timezone, active flag, learn items, FAQ). There is a single landing at /webinar-gratuito — not multiple editions.",
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
