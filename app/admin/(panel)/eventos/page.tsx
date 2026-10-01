import FreeEventsPageClient, {
  type FreeEventListItem,
} from "@/app/components/admin/crm/free-events/FreeEventsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { eventDateLabel, listFreeEvents } from "@/lib/crm/free-events";
import { freeEventEditionsEnabled } from "@/lib/crm/free-event-settings";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";

export const dynamic = "force-dynamic";

/**
 * Los eventos gratuitos, uno por fila, como los talleres. «Próximos» (el
 * publicado, los cerrados que aún no pasan y los borradores) y «Pasados»
 * (`?vista=pasados`, a donde redirige el antiguo Historial).
 */
const FreeEventsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) => {
  const sp = await searchParams;
  const preview = isCrmUiPreview();
  const [rows, tz, editionsEnabled] = await Promise.all([
    preview ? Promise.resolve([]) : listFreeEvents(),
    getOperationalTimezone(),
    preview ? Promise.resolve(false) : freeEventEditionsEnabled(),
  ]);

  const events: FreeEventListItem[] = rows.map((e) => ({
    id: e.id,
    headline: e.headline,
    eventLabel: e.eventLabel,
    status: e.status,
    publicPath: e.publicPath,
    dateLabel: eventDateLabel(e, tz),
    registrations: e.registrations,
    stats: {
      linkSent: e.stats.linkSent,
      reminder24h: e.stats.reminder24h,
      reminder1h: e.stats.reminder1h,
      wa24h: e.stats.wa24h,
      wa1h: e.stats.wa1h,
      waConfirmation: e.stats.waConfirmation,
    },
  }));

  // Sin próximos, se abre en los pasados: es lo que hay que ver.
  const hasUpcoming = events.some((e) => e.status !== "COMPLETED");
  const initialView =
    sp.vista === "pasados" || (!sp.vista && !hasUpcoming && events.length > 0) ? "pasados" : "proximos";

  return (
    <FreeEventsPageClient
      events={events}
      initialView={initialView}
      editionsEnabled={editionsEnabled}
      operationalTimezone={tz}
    />
  );
};

export default FreeEventsPage;
