import { defineTool } from "eve/tools";
import { z } from "zod";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { endedEventAgentMessage, FREE_EVENT_PUBLIC_ROOT, isFreeEventEnded } from "@/lib/crm/free-event-rules";
import { countWebinarRegistrations } from "@/lib/crm/webinar-registrations";
import { siteUrl } from "@/lib/notifications/config";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Get the CURRENT free event (headline, schedule in CRM operational timezone, status, meet link, learn items, FAQ, registration count). Free events are editions like workshops: each one has its own row, status (DRAFT, OPEN = published and taking registrations at /eventos-gratuitos, CLOSED = registrations closed but the event hasn't happened yet, COMPLETED = already happened) and its own registrants. The current one is the published one; if none is published, the upcoming closed one, then the draft being prepared, then the last one held. `endedAt` set means it already happened: then `notice` says so — it can be read but not edited or rescheduled (create the next one in /admin/eventos). Past events and their history live in the CRM at /admin/eventos.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const webinar = await ensureFreeWebinar();
    const registrations = await countWebinarRegistrations(webinar.id);
    const isOpen = webinar.status === "OPEN" && Boolean(webinar.startsAt) && !webinar.endedAt;
    const ended = isFreeEventEnded(webinar);
    return {
      // Ya pasó: se puede consultar, no modificar. Se dice de entrada para que
      // el agente no intente reprogramarlo.
      ...(ended ? { notice: endedEventAgentMessage(webinar.headline) } : {}),
      webinar: {
        registrations,
        id: webinar.id,
        status: webinar.status,
        ended,
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
        publishedAt: webinar.publishedAt,
        videoStatus: webinar.videoStatus,
        hasVideo: webinar.videoStatus === "READY",
        learnSectionTitle: webinar.learnSectionTitle,
        learnItems: webinar.learnItems,
        faq: webinar.faq,
        ctaLabel: webinar.ctaLabel,
        formTitle: webinar.formTitle,
        metaTitle: webinar.metaTitle,
        metaDescription: webinar.metaDescription,
        waConfirmationEnabled: webinar.waConfirmationEnabled,
        link: isOpen ? `${siteUrl()}${FREE_EVENT_PUBLIC_ROOT}` : null,
        eventPage: `${siteUrl()}${webinar.publicPath}`,
        crm: `${siteUrl()}/admin/eventos/${webinar.id}`,
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
