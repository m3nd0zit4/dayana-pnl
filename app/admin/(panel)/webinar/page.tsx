import FreeWebinarAdminClient from "@/app/components/admin/crm/FreeWebinarAdminClient";
import type { WebinarRegistrantRow } from "@/app/components/admin/crm/WebinarRegistrantsPanel";
import { ensureFreeWebinar, DEFAULT_FREE_WEBINAR } from "@/lib/crm/free-webinar";
import { listWebinarRegistrations } from "@/lib/crm/webinar-registrations";
import {
  getOperationalTimezone,
} from "@/lib/crm/operational-timezone";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const WebinarAdminPage = async () => {
  const operationalTimezone = await getOperationalTimezone();

  if (isCrmUiPreview()) {
    const now = new Date();
    return (
      <FreeWebinarAdminClient
        operationalTimezone={operationalTimezone}
        registrations={[]}
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
          operationalTimezone,
          meetUrl: null,
          muxPlaybackId: null,
          videoStatus: "NONE",
          videoDurationSec: null,
          videoErrorMessage: null,
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
  const rows = await listWebinarRegistrations(webinar.id).catch(() => []);

  // Se aplana aquí: el panel es un componente cliente y las fechas tienen que
  // cruzar la frontera como cadenas.
  const registrations: WebinarRegistrantRow[] = rows.map((r) => ({
    id: r.id,
    contactId: r.contact.id,
    name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" "),
    email: r.contact.email,
    phoneE164: r.contact.phoneE164,
    notifyEmail: r.contact.notifyEmail,
    createdAtIso: r.createdAt.toISOString(),
    linkEmailSentAt: r.linkEmailSentAt?.toISOString() ?? null,
    reminder24hSentAt: r.reminder24hSentAt?.toISOString() ?? null,
    reminder1hSentAt: r.reminder1hSentAt?.toISOString() ?? null,
  }));

  return (
    <FreeWebinarAdminClient
      initial={webinar}
      operationalTimezone={webinar.operationalTimezone ?? operationalTimezone}
      registrations={registrations}
    />
  );
};

export default WebinarAdminPage;
