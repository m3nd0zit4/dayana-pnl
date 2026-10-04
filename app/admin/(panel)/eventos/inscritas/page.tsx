import Link from "next/link";
import { Users } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import {
  FreeEventPeopleSearch,
  FreeEventSwitcher,
} from "@/app/components/admin/crm/FreeEventPeopleFilters";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import { Badge } from "@/app/components/ui/badge";
import { buttonVariants } from "@/app/components/ui/button";
import { isCrmUiPreview } from "@/lib/auth/preview";
import {
  eventDateLabel,
  FREE_EVENT_STATUS_LABEL,
  isFreeEventOpen,
  isFreeEventUpcoming,
  listFreeEventPeople,
  listFreeEvents,
  type FreeEventPeoplePage,
  type FreeEventRow,
} from "@/lib/crm/free-events";
import { EVENT_WA_TEMPLATE_KEY, eventWaTemplateKey } from "@/lib/crm/event-whatsapp-reminders";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { listRegistrationContactIds } from "@/lib/crm/webinar-registrations";
import { freeEventPresetsFor } from "@/lib/crm/whatsapp-presets";
import PeopleWhatsAppList from "@/app/components/admin/whatsapp/PeopleWhatsAppList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Badges de evento por persona: cuántos se ven antes de resumir. */
const MAX_EVENT_BADGES = 3;

const shorten = (s: string, max = 26) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/**
 * Las personas que se han inscrito a eventos gratuitos: una fila por persona,
 * con todos los eventos a los que fue. Sirve para ver quién repite y para
 * escribirle a quien ya mostró interés. Los mensajes listos cambian según el
 * evento que se mira (ver `freeEventPresetsFor`).
 */
const FreeEventPeoplePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ evento?: string; q?: string; pagina?: string }>;
}) => {
  const sp = await searchParams;
  const eventId = sp.evento?.trim() || null;
  const q = sp.q?.trim() || "";
  const page = Math.max(Number(sp.pagina) || 1, 1);

  const preview = isCrmUiPreview();
  const empty: FreeEventPeoplePage = {
    people: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
  };
  const [events, result, tz, reminderTemplateKey] = await Promise.all([
    preview ? Promise.resolve([] as FreeEventRow[]) : listFreeEvents(),
    preview
      ? Promise.resolve(empty)
      : listFreeEventPeople({ eventId, q, page, pageSize: PAGE_SIZE }),
    getOperationalTimezone(),
    // La plantilla del recordatorio: la de utilidad si Meta ya la aprobó.
    preview ? Promise.resolve(EVENT_WA_TEMPLATE_KEY) : eventWaTemplateKey(),
  ]);

  // Como la lista de eventos: el publicado, los que vienen y los pasados.
  const ordered = events;
  const selected = eventId
    ? (events.find((e) => e.id === eventId) ?? null)
    : null;
  const selectedUpcoming = selected ? isFreeEventUpcoming(selected) : false;
  const openEvent = events.find(isFreeEventOpen) ?? null;
  const presets = freeEventPresetsFor(
    {
      selected: selected ? { ...selected, id: selected.id } : null,
      selectedUpcoming,
      openEvent: openEvent && openEvent.id !== selected?.id ? openEvent : null,
      reminderTemplateKey,
    },
    tz
  );

  // «Enviar a todas» = todas las del filtro, no solo esta página.
  const allContactIds = preview
    ? []
    : q
      ? result.people.map((p) => p.contactId)
      : await listRegistrationContactIds(eventId);

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    if (eventId) params.set("evento", eventId);
    if (q) params.set("q", q);
    if (nextPage > 1) params.set("pagina", String(nextPage));
    const qs = params.toString();
    return `/admin/eventos/inscritas${qs ? `?${qs}` : ""}`;
  };
  const shortDate = (d: Date | null) =>
    d
      ? d.toLocaleDateString("es-CO", {
          timeZone: tz,
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "sin fecha";
  const repeaters = result.people.filter((p) => p.events.length > 1).length;

  const peopleCount =
    result.total > 0
      ? `${result.total.toLocaleString("es-CO")} ${result.total === 1 ? "persona" : "personas"}${q ? " coinciden con la búsqueda" : ""}`
      : null;
  const description = selected ? (
    <>
      <strong className="font-medium text-foreground">
        «{selected.headline}»
      </strong>{" "}
      · {FREE_EVENT_STATUS_LABEL[selected.status]}
      {" · "}
      {eventDateLabel(selected, tz)}
      {peopleCount ? ` · ${peopleCount}` : ""}
    </>
  ) : eventId ? (
    "Evento no encontrado."
  ) : (
    <>
      <strong className="font-medium text-foreground">Todos los eventos</strong>
      {peopleCount
        ? ` · ${peopleCount}`
        : " · Quién se ha inscrito a tus eventos gratuitos."}
    </>
  );

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Inscritas"
        description={description}
        trailing={
          <FreeEventSwitcher
            // Se remonta al cambiar de evento: la pestaña marcada es la de la URL.
            key={eventId ?? "todos"}
            value={eventId}
            q={q}
            segments={ordered.map((e) => ({
              id: e.id,
              label:
                e.status === "OPEN"
                  ? `Publicado · ${shorten(e.headline)}`
                  : `${shortDate(e.startsAt)} · ${shorten(e.headline, 20)}`,
              count: e.registrations,
            }))}
          />
        }
      />

      <FreeEventPeopleSearch eventId={eventId} q={q} />

      {result.people.length === 0 ? (
        <CrmEmptyState
          icon={Users}
          title={
            q || eventId
              ? "Nadie coincide con el filtro"
              : "Todavía no hay inscritas"
          }
          description={
            q || eventId
              ? undefined
              : "Cuando alguien se inscriba a un evento gratuito aparecerá aquí."
          }
        />
      ) : (
        <>
          {repeaters > 0 ? (
            <p className="text-xs text-muted-foreground">
              {repeaters} de esta página fueron a más de un evento.
            </p>
          ) : null}
          <PeopleWhatsAppList
            people={result.people.map((person) => {
              // El evento que se mira siempre a la vista, aunque la persona
              // haya ido a varios después.
              const at = selected
                ? person.events.findIndex((e) => e.id === selected.id)
                : -1;
              const shown =
                at >= MAX_EVENT_BADGES
                  ? [
                      ...person.events.slice(0, MAX_EVENT_BADGES - 1),
                      person.events[at],
                    ]
                  : person.events.slice(0, MAX_EVENT_BADGES);
              return {
                contactId: person.contactId,
                name: person.name,
                detail:
                  [person.email, person.phoneE164].filter(Boolean).join(" · ") ||
                  "—",
                extra: (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {person.events.length > 1 ? (
                      <Badge variant="secondary">
                        {person.events.length} eventos
                      </Badge>
                    ) : null}
                    {shown.map((e) => {
                      const isSelected = e.id === selected?.id;
                      return (
                        <Link
                          key={e.id}
                          href={`/admin/eventos/${e.id}?tab=inscritas`}
                          title={e.headline}
                          aria-current={isSelected ? "true" : undefined}
                        >
                          <Badge
                            variant={isSelected ? "default" : "outline"}
                            className={isSelected ? undefined : "hover:bg-accent"}
                          >
                            {shortDate(e.startsAt)}
                          </Badge>
                        </Link>
                      );
                    })}
                  </span>
                ),
              };
            })}
            allContactIds={allContactIds}
            presets={presets}
            kind="evento"
            title={
              selected
                ? `Evento: ${selected.headline}`
                : "Inscritas de todos los eventos"
            }
            source="eventos"
            allLabel={
              eventId
                ? "Enviar a todas las del evento"
                : q
                  ? "Enviar a las de la búsqueda"
                  : "Enviar a todas las inscritas"
            }
            // Con un evento elegido, el envío queda en su historia.
            link={selected ? { freeWebinarId: selected.id } : undefined}
          />
          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link
                  href={hrefFor(page - 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                {page} de {pages}
              </span>
              {page < pages ? (
                <Link
                  href={hrefFor(page + 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Siguiente
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </>
      )}
    </CrmPageShell>
  );
};

export default FreeEventPeoplePage;
