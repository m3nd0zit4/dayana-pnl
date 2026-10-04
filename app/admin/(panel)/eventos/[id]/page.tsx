import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, MessageCircle } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import WebinarRegistrantsPanel, {
  type WebinarRegistrantRow,
} from "@/app/components/admin/crm/WebinarRegistrantsPanel";
import EditionStatusBadge from "@/app/components/admin/crm/editions/EditionStatusBadge";
import EditionTabs from "@/app/components/admin/crm/editions/EditionTabs";
import FreeEventDetailActions from "@/app/components/admin/crm/free-events/FreeEventDetailActions";
import FreeEventHistory from "@/app/components/admin/crm/free-events/FreeEventHistory";
import FreeEventPageEditor from "@/app/components/admin/crm/free-events/FreeEventPageEditor";
import {
  freeEventTabSpecs,
  parseFreeEventTab,
  type FreeEventTab,
} from "@/app/components/admin/crm/free-events/tabs";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import PeopleWhatsAppList from "@/app/components/admin/whatsapp/PeopleWhatsAppList";
import WhatsAppBulkSend from "@/app/components/admin/whatsapp/WhatsAppBulkSend";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import {
  EVENT_WA_TEMPLATE_KEY,
  eventWaRemindersEnabled,
} from "@/lib/crm/event-whatsapp-reminders";
import {
  eventDateLabel,
  getFreeEventTimeline,
  isFreeEventMaterialDownloadable,
  isFreeEventUpcoming,
  listFreeEventInviteContactIds,
  listFreeEventRegistrantsForWhatsApp,
} from "@/lib/crm/free-events";
import { freeEventEditionsEnabled } from "@/lib/crm/free-event-settings";
import { isFreeEventEnded } from "@/lib/crm/free-event-rules";
import {
  getFreeEventById,
  getOpenFreeEvent,
  type FreeWebinarPublic,
} from "@/lib/crm/free-webinar";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { canBroadcastNotifications } from "@/lib/crm/staff-permissions";
import {
  countPendingLinkRecipients,
  countWebinarRegistrations,
  listRegistrationContactIds,
  listWebinarRegistrations,
  webinarRegistrationStats,
} from "@/lib/crm/webinar-registrations";
import { freeEventPresetsFor } from "@/lib/crm/whatsapp-presets";
import { getWhatsAppTemplateStatus } from "@/lib/crm/whatsapp-templates";

export const dynamic = "force-dynamic";

/** Primera página del panel de inscritas; el resto se pide desde el cliente. */
const PAGE_SIZE = 50;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
};

const EMPTY_STATS = {
  total: 0,
  linkSent: 0,
  reminder24h: 0,
  reminder1h: 0,
  unreachable: 0,
  pendingLink: 0,
  failed: 0,
  wa24h: 0,
  wa1h: 0,
  waFailed: 0,
  noWhatsApp: 0,
  waConfirmation: 0,
};

/** «Inscritas»: el panel de siempre, ahora de ESTE evento. */
const RegistrantsTab = async ({ event }: { event: FreeWebinarPublic }) => {
  const [rows, stats, waEnabled, templateStatus, staff] = await Promise.all([
    listWebinarRegistrations(event.id, { take: PAGE_SIZE }).catch(() => []),
    webinarRegistrationStats(event.id).catch(() => EMPTY_STATS),
    eventWaRemindersEnabled(),
    getWhatsAppTemplateStatus(EVENT_WA_TEMPLATE_KEY).catch(() => null),
    getStaffSession().catch(() => null),
  ]);
  // Las fechas cruzan al cliente como cadenas.
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
    notifyWhatsapp: r.contact.notifyWhatsapp,
    reminder24hWaSentAt: r.reminder24hWaSentAt?.toISOString() ?? null,
    reminder1hWaSentAt: r.reminder1hWaSentAt?.toISOString() ?? null,
    waReminderError: r.waReminderError,
    confirmationWaSentAt: r.confirmationWaSentAt?.toISOString() ?? null,
    confirmationWaError: r.confirmationWaError,
  }));
  return (
    <div className="flex flex-col gap-3">
      <WebinarRegistrantsPanel
        key={event.id}
        webinarId={event.id}
        apiBase={`/api/admin/eventos/${event.id}`}
        registrations={registrations}
        stats={stats}
        // Reenviar a todas es de OWNER; la ruta lo vuelve a comprobar.
        canBroadcast={staff ? canBroadcastNotifications(staff.role) : false}
        whatsApp={{ enabled: waEnabled, templateStatus }}
        capacity={event.capacity}
      />
      {stats.total > 0 ? (
        <Link
          href={`/admin/eventos/inscritas?evento=${event.id}`}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Ver si fueron a otros eventos
        </Link>
      ) : null}
    </div>
  );
};

/**
 * «WhatsApp»: como la página de WhatsApp de un taller. Las inscritas de este
 * evento con los mensajes que tienen sentido según su estado, y —mientras
 * está publicado— la invitación a quienes aceptaron recibir novedades. Todo lo
 * que se envía desde aquí queda en la historia del evento.
 */
const WhatsAppTab = async ({ event, tz }: { event: FreeWebinarPublic; tz: string }) => {
  const [registrants, allContactIds, openEvent, inviteIds] = await Promise.all([
    listFreeEventRegistrantsForWhatsApp(event.id, 100),
    listRegistrationContactIds(event.id),
    getOpenFreeEvent(),
    event.status === "OPEN" ? listFreeEventInviteContactIds(event.id) : Promise.resolve([] as string[]),
  ]);
  const selected = {
    id: event.id,
    headline: event.headline,
    startsAt: event.startsAt,
    startsAtHasTime: event.startsAtHasTime,
    meetUrl: event.meetUrl,
    materialDownloadable: isFreeEventMaterialDownloadable(event),
  };
  const presets = freeEventPresetsFor(
    {
      selected,
      selectedUpcoming: isFreeEventUpcoming(event),
      openEvent: openEvent && openEvent.id !== event.id ? openEvent : null,
    },
    tz
  );
  const invitePresets = freeEventPresetsFor({ selected: null, selectedUpcoming: false, openEvent: selected }, tz);
  const link = { freeWebinarId: event.id };
  const shortDate = (d: Date) =>
    d.toLocaleDateString("es-CO", { timeZone: tz, day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-4">
      {event.status === "OPEN" ? (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Invitar al evento</div>
            <div className="text-xs text-muted-foreground">
              {inviteIds.length.toLocaleString("es-CO")} contactos aceptaron recibir novedades y todavía no se
              inscribieron.
            </div>
          </div>
          <WhatsAppBulkSend
            contactIds={inviteIds}
            presets={invitePresets}
            kind="evento"
            title={`Evento: ${event.headline} (invitación)`}
            label="Invitar por WhatsApp"
            link={link}
          />
        </section>
      ) : null}

      {registrants.length === 0 ? (
        <CrmEmptyState
          icon={MessageCircle}
          title="Todavía no hay inscritas"
          description="Cuando alguien se inscriba podrás escribirles desde aquí."
        />
      ) : (
        <>
          <PeopleWhatsAppList
            key={event.id}
            people={registrants.map((p) => ({
              contactId: p.contactId,
              name: p.name,
              detail: [p.phoneE164, p.email, `inscrita el ${shortDate(p.registeredAt)}`].filter(Boolean).join(" · "),
            }))}
            allContactIds={allContactIds}
            presets={presets}
            kind="evento"
            title={`Evento: ${event.headline}`}
            source="eventos"
            allLabel="Enviar a todas las inscritas"
            link={link}
            timeZone={tz}
          />
          {allContactIds.length > registrants.length ? (
            <Link
              href={`/admin/eventos/inscritas?evento=${event.id}`}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Ver las {allContactIds.length.toLocaleString("es-CO")} inscritas
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
};

/**
 * Un evento gratuito, como una edición de taller: su página, sus inscritas,
 * WhatsApp y su historia, cada una en su pestaña (`?tab=`). El paso que le
 * toca (publicar, cerrar inscripciones, terminar, reabrir) va en la cabecera.
 */
const FreeEventDetailPage = async ({ params, searchParams }: PageProps) => {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: FreeEventTab = parseFreeEventTab(sp.tab);

  if (isCrmUiPreview()) {
    return (
      <CrmPageShell>
        <CrmPageHeader
          title="Evento"
          backHref="/admin/eventos"
          backLabel="Eventos"
          trailing={
            <EditionTabs
              basePath={`/admin/eventos/${id}`}
              value={tab}
              tabs={freeEventTabSpecs(0)}
              ariaLabel="Secciones del evento"
            />
          }
        />
        <CrmEmptyState icon={CalendarDays} title="Vista previa sin datos" />
      </CrmPageShell>
    );
  }

  const event = await getFreeEventById(id);
  if (!event) notFound();

  const [tz, registrations, editionsEnabled, openEvent] = await Promise.all([
    getOperationalTimezone(),
    countWebinarRegistrations(event.id),
    freeEventEditionsEnabled(),
    getOpenFreeEvent(),
  ]);

  // Junto a «Cerrar inscripciones» y «Terminar»: cuál corta qué.
  const lifecycleHint =
    event.status === "OPEN"
      ? "«Cerrar inscripciones» deja de aceptar registros pero el enlace y los recordatorios siguen saliendo; «Terminar» corta todo."
      : event.status === "CLOSED"
        ? "Inscripciones cerradas: quien ya se inscribió sigue recibiendo el enlace y los recordatorios. «Terminar» corta todo."
        : null;
  const description = (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <EditionStatusBadge status={event.status} />
        <span>
          {eventDateLabel(event, tz)} · {event.eventLabel}
        </span>
      </span>
      {/* En el teléfono no cabe: lo explica la confirmación de cada botón. */}
      {lifecycleHint ? <span className="mt-1 hidden text-xs sm:block">{lifecycleHint}</span> : null}
    </>
  );

  let content: React.ReactNode;
  if (tab === "inscritas") {
    content = <RegistrantsTab event={event} />;
  } else if (tab === "whatsapp") {
    content = <WhatsAppTab event={event} tz={tz} />;
  } else if (tab === "historia") {
    content = <FreeEventHistory timeline={await getFreeEventTimeline(event.id, tz)} timeZone={tz} />;
  } else {
    const pendingLink = await countPendingLinkRecipients(event.id).catch(() => 0);
    content = (
      <FreeEventPageEditor
        key={event.id}
        initial={event}
        operationalTimezone={tz}
        apiBase={`/api/admin/eventos/${event.id}`}
        pendingLink={pendingLink}
        ended={isFreeEventEnded(event)}
      />
    );
  }

  return (
    <CrmPageShell>
      <CrmPageHeader
        title={event.headline}
        description={description}
        backHref="/admin/eventos"
        backLabel="Eventos"
        secondaryActions={
          <FreeEventDetailActions
            event={{
              id: event.id,
              headline: event.headline,
              status: event.status,
              publicPath: event.publicPath,
              registrations,
            }}
            openOther={openEvent && openEvent.id !== event.id ? { id: openEvent.id, headline: openEvent.headline } : null}
            editionsEnabled={editionsEnabled}
          />
        }
        trailing={
          <EditionTabs
            key={tab}
            basePath={`/admin/eventos/${event.id}`}
            value={tab}
            tabs={freeEventTabSpecs(registrations)}
            ariaLabel="Secciones del evento"
          />
        }
      />
      {content}
    </CrmPageShell>
  );
};

export default FreeEventDetailPage;
