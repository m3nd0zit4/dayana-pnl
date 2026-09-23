import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import DeleteFreeEventButton from "@/app/components/admin/crm/DeleteFreeEventButton";
import {
  CrmDataList,
  CrmDataListHeader,
  CrmDataListRow,
  CrmEmptyState,
} from "@/app/components/admin/crm/ui";
import { Badge } from "@/app/components/ui/badge";
import { buttonVariants } from "@/app/components/ui/button";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  eventDateLabel,
  FREE_EVENT_STATUS_LABEL,
  getFreeEventDetail,
} from "@/lib/crm/free-events";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { canBroadcastNotifications } from "@/lib/crm/staff-permissions";

export const dynamic = "force-dynamic";

/** Un evento del historial: sus datos y todas las personas inscritas. */
const FreeEventDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  if (isCrmUiPreview()) {
    return (
      <CrmPageShell>
        <CrmPageHeader
          title="Evento"
          backHref="/admin/eventos/historial"
          backLabel="Historial"
        />
        <CrmEmptyState icon={Users} title="Sin inscritas" />
      </CrmPageShell>
    );
  }

  const { id } = await params;
  const [event, tz, staff] = await Promise.all([
    getFreeEventDetail(id),
    getOperationalTimezone(),
    getStaffSession().catch(() => null),
  ]);
  if (!event) notFound();

  // Borrar una edición archivada se lleva su lista: solo OWNER, y nunca la
  // actual (la ruta lo vuelve a comprobar).
  const canDelete =
    !event.isCurrent && staff ? canBroadcastNotifications(staff.role) : false;

  const date = (d: Date) =>
    d.toLocaleDateString("es-CO", {
      timeZone: tz,
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <CrmPageShell>
      <CrmPageHeader
        title={event.headline}
        description={`${event.eventLabel} · ${eventDateLabel(event, tz)}`}
        backHref="/admin/eventos/historial"
        backLabel="Historial"
        secondaryActions={
          canDelete ? (
            <DeleteFreeEventButton
              id={event.id}
              label={eventDateLabel(event, tz)}
              registrations={event.registrations}
            />
          ) : null
        }
        action={
          event.isCurrent ? (
            <Link
              href="/admin/eventos"
              data-crm-primary-action=""
              className={buttonVariants()}
            >
              Editar evento
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={event.isCurrent ? "default" : "outline"}>
          {FREE_EVENT_STATUS_LABEL[event.status]}
        </Badge>
        <span className="text-muted-foreground">
          {event.registrations.toLocaleString("es-CO")}{" "}
          {event.registrations === 1
            ? "persona inscrita"
            : "personas inscritas"}
        </span>
        {event.registrations > 0 ? (
          <Link
            href={`/admin/eventos/inscritas?evento=${event.id}`}
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Ver si fueron a otros eventos
          </Link>
        ) : null}
      </div>

      {event.registrants.length === 0 ? (
        <CrmEmptyState icon={Users} title="Nadie se inscribió a este evento" />
      ) : (
        <CrmDataList>
          <CrmDataListHeader>
            <span className="flex-1">Persona</span>
            <span className="w-56">Contacto</span>
            <span className="w-28 text-right">Inscrita el</span>
          </CrmDataListHeader>
          {event.registrants.map((r) => (
            <CrmDataListRow key={r.registrationId}>
              <Link
                href={`/admin/contacts/${r.contactId}`}
                className="min-w-40 flex-1 truncate text-sm font-medium hover:underline"
              >
                {r.name}
              </Link>
              <span className="w-full truncate text-xs text-muted-foreground lg:w-56">
                {[r.email, r.phoneE164].filter(Boolean).join(" · ") || "—"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums lg:w-28 lg:text-right">
                {date(r.registeredAt)}
              </span>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
    </CrmPageShell>
  );
};

export default FreeEventDetailPage;
