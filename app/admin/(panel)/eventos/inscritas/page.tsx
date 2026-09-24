import Link from "next/link";
import { Users } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import { Badge } from "@/app/components/ui/badge";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { isCrmUiPreview } from "@/lib/auth/preview";
import {
  listFreeEventPeople,
  listFreeEvents,
  type FreeEventPeoplePage,
  type FreeEventRow,
} from "@/lib/crm/free-events";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { prisma } from "@/lib/db";
import { freeEventPresets } from "@/lib/crm/whatsapp-presets";
import PeopleWhatsAppList from "@/app/components/admin/whatsapp/PeopleWhatsAppList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Las personas que se han inscrito a eventos gratuitos: una fila por persona,
 * con todos los eventos a los que fue. Sirve para ver quién repite y para
 * escribirle a quien ya mostró interés.
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
  const [events, result, tz] = await Promise.all([
    preview ? Promise.resolve([] as FreeEventRow[]) : listFreeEvents(),
    preview
      ? Promise.resolve(empty)
      : listFreeEventPeople({ eventId, q, page, pageSize: PAGE_SIZE }),
    getOperationalTimezone(),
  ]);

  // El evento del que se habla en los mensajes: el filtrado, o el actual.
  const focusEvent =
    (eventId ? events.find((e) => e.id === eventId) : null) ??
    events.find((e) => e.isCurrent) ??
    events[0] ??
    null;
  const presets = freeEventPresets(focusEvent, tz);
  // «Enviar a todas» = todas las del filtro, no solo esta página.
  const allContactIds = preview
    ? []
    : q
      ? result.people.map((p) => p.contactId)
      : [
          ...new Set(
            (
              await prisma.webinarRegistration.findMany({
                where: eventId ? { webinarId: eventId } : {},
                select: { contactId: true },
              })
            ).map((r) => r.contactId)
          ),
        ];

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

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Inscritas"
        description={
          result.total > 0
            ? `${result.total.toLocaleString("es-CO")} ${result.total === 1 ? "persona" : "personas"}${eventId ? " en este evento" : " en todos los eventos"}`
            : "Quién se ha inscrito a tus eventos gratuitos."
        }
      />

      <form
        className="flex flex-wrap items-end gap-2"
        action="/admin/eventos/inscritas"
        method="get"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Evento
          <select
            name="evento"
            defaultValue={eventId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="">Todos los eventos</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {shortDate(e.startsAt)} · {e.headline}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Buscar
          <Input
            name="q"
            defaultValue={q}
            placeholder="Nombre, correo o teléfono"
          />
        </label>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

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
            people={result.people.map((person) => ({
              contactId: person.contactId,
              name: person.name,
              detail: [person.email, person.phoneE164].filter(Boolean).join(" · ") || "—",
              extra: (
                <span className="mt-1 flex flex-wrap gap-1">
                  {person.events.length > 1 ? <Badge>{person.events.length} eventos</Badge> : null}
                  {person.events.slice(0, 3).map((e) => (
                    <Link key={e.id} href={`/admin/eventos/historial/${e.id}`}>
                      <Badge variant="outline" className="hover:bg-accent">
                        {shortDate(e.startsAt)}
                      </Badge>
                    </Link>
                  ))}
                </span>
              ),
            }))}
            allContactIds={allContactIds}
            presets={presets}
            kind="evento"
            title={focusEvent ? `Evento: ${focusEvent.headline}` : "Eventos gratuitos"}
            source="eventos"
            allLabel={eventId ? `Enviar a todas las del evento` : q ? "Enviar a las de la búsqueda" : "Enviar a todas las inscritas"}
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
