import FreeWebinarAdminClient from "@/app/components/admin/crm/FreeWebinarAdminClient";
import type { WebinarRegistrantRow } from "@/app/components/admin/crm/WebinarRegistrantsPanel";
import type { ArchivedEditionRow } from "@/app/components/admin/crm/WebinarEditionsPanel";
import {
  ensureFreeWebinar,
  DEFAULT_FREE_WEBINAR,
  listArchivedWebinars,
} from "@/lib/crm/free-webinar";
import { getStaffSession } from "@/lib/auth/staff-session";
import { canBroadcastNotifications } from "@/lib/crm/staff-permissions";
import {
  listWebinarRegistrations,
  webinarRegistrationStats,
} from "@/lib/crm/webinar-registrations";

/** Primera página del panel; el resto se pide desde el cliente. */
const PAGE_SIZE = 50;
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
        registrationStats={{
          total: 0,
          linkSent: 0,
          reminder24h: 0,
          reminder1h: 0,
          unreachable: 0,
          pendingLink: 0,
          failed: 0,
        }}
        archivedEditions={[]}
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
          capacity: 100,
          materialUrl: null,
          materialFileName: null,
          materialMimeType: null,
          materialSizeBytes: null,
          endedAt: null,
          archivedAt: null,
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
  // Solo la primera página. Con 10k registradas, traerlas todas reventaría el
  // servidor y el DOM; los totales salen de contadores agregados.
  const [rows, stats] = await Promise.all([
    listWebinarRegistrations(webinar.id, { take: PAGE_SIZE }).catch(() => []),
    webinarRegistrationStats(webinar.id).catch(() => ({
      total: 0,
      linkSent: 0,
      reminder24h: 0,
      reminder1h: 0,
      unreachable: 0,
      pendingLink: 0,
      failed: 0,
    })),
  ]);

  const [archived, staff] = await Promise.all([
    listArchivedWebinars().catch(() => []),
    getStaffSession().catch(() => null),
  ]);
  // Reenviar a todas y borrar historial son acciones de OWNER; la UI oculta
  // los botones y la ruta lo vuelve a comprobar.
  const canBroadcast = staff ? canBroadcastNotifications(staff.role) : false;

  const archivedEditions: ArchivedEditionRow[] = archived.map((e) => ({
    id: e.id,
    headline: e.headline,
    startsAtIso: e.startsAt?.toISOString() ?? null,
    startsAtHasTime: e.startsAtHasTime,
    archivedAtIso: e.archivedAt?.toISOString() ?? null,
    registrations: e.registrations,
  }));

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
    lastSendError: r.lastSendError,
    lastSendErrorAt: r.lastSendErrorAt?.toISOString() ?? null,
  }));

  return (
    <FreeWebinarAdminClient
      initial={webinar}
      operationalTimezone={webinar.operationalTimezone ?? operationalTimezone}
      registrations={registrations}
      registrationStats={stats}
      archivedEditions={archivedEditions}
      canBroadcast={canBroadcast}
    />
  );
};

export default WebinarAdminPage;
