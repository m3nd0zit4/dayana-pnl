import FreeWebinarAdminClient from "@/app/components/admin/crm/FreeWebinarAdminClient";
import { ensureFreeWebinar, DEFAULT_FREE_WEBINAR } from "@/lib/crm/free-webinar";
import { OPERATIONAL_TZ } from "@/lib/crm/operational-timezone";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const WebinarAdminPage = async () => {
  if (isCrmUiPreview()) {
    const now = new Date();
    return (
      <FreeWebinarAdminClient
        operationalTimezone={OPERATIONAL_TZ}
        initial={{
          id: "preview",
          slug: "gratuito",
          isActive: false,
          headline: DEFAULT_FREE_WEBINAR.headline,
          subheadline: DEFAULT_FREE_WEBINAR.subheadline,
          body: DEFAULT_FREE_WEBINAR.body,
          startsAt: null,
          startsAtIso: null,
          startsAtDateKey: null,
          startsAtTimeHm: null,
          startsAtHasTime: false,
          operationalTimezone: OPERATIONAL_TZ,
          videoUrl: null,
          learnSectionTitle: DEFAULT_FREE_WEBINAR.learnSectionTitle,
          learnItems: DEFAULT_FREE_WEBINAR.learnItems,
          faq: DEFAULT_FREE_WEBINAR.faq,
          ctaLabel: DEFAULT_FREE_WEBINAR.ctaLabel,
          formTitle: DEFAULT_FREE_WEBINAR.formTitle,
          metaTitle: DEFAULT_FREE_WEBINAR.metaTitle,
          metaDescription: DEFAULT_FREE_WEBINAR.metaDescription,
          updatedAt: now,
        }}
      />
    );
  }

  const webinar = await ensureFreeWebinar();
  return (
    <FreeWebinarAdminClient
      initial={webinar}
      operationalTimezone={OPERATIONAL_TZ}
    />
  );
};

export default WebinarAdminPage;
