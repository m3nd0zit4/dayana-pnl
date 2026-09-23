import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
} from "@/app/components/admin/crm/ui";
import { Badge } from "@/app/components/ui/badge";
import { isCrmUiPreview } from "@/lib/auth/preview";
import {
  eventDateLabel,
  FREE_EVENT_STATUS_LABEL,
  listFreeEvents,
  type FreeEventRow,
} from "@/lib/crm/free-events";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";

export const dynamic = "force-dynamic";

/**
 * Todos los eventos gratuitos, el actual y los anteriores, con cuántas
 * personas se inscribieron a cada uno. Cada fila abre su lista de inscritas.
 */
const FreeEventHistoryPage = async () => {
  const preview = isCrmUiPreview();
  const [events, tz] = await Promise.all([
    preview ? Promise.resolve([] as FreeEventRow[]) : listFreeEvents(),
    getOperationalTimezone(),
  ]);
  const totalRegistrations = events.reduce((n, e) => n + e.registrations, 0);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Historial de eventos"
        description={
          events.length > 0
            ? `${events.length} ${events.length === 1 ? "evento" : "eventos"} · ${totalRegistrations.toLocaleString("es-CO")} inscripciones en total`
            : "Los eventos gratuitos que has hecho y quién se inscribió."
        }
      />

      {events.length === 0 ? (
        <CrmEmptyState
          icon={CalendarDays}
          title="Todavía no hay eventos"
          description="Cuando publiques tu primer evento gratuito aparecerá aquí, con sus inscritas."
        />
      ) : (
        <CrmDataList>
          {events.map((event) => (
            <CrmDataListRow key={event.id} className="p-0">
              <Link
                href={`/admin/eventos/historial/${event.id}`}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {event.headline}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {event.eventLabel} · {eventDateLabel(event, tz)}
                  </span>
                </span>
                <Badge variant={event.isCurrent ? "default" : "outline"}>
                  {FREE_EVENT_STATUS_LABEL[event.status]}
                </Badge>
                <span className="w-28 text-right text-sm tabular-nums">
                  {event.registrations.toLocaleString("es-CO")}{" "}
                  <span className="text-muted-foreground">inscritas</span>
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
    </CrmPageShell>
  );
};

export default FreeEventHistoryPage;
