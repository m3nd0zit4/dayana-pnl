import Link from "next/link";
import { Users } from "lucide-react";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import {
  CrmDataList,
  CrmDataListHeader,
  CrmDataListRow,
  CrmEmptyState,
} from "@/app/components/admin/crm/ui";
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
          <CrmDataList>
            <CrmDataListHeader>
              <span className="flex-1">Persona</span>
              <span className="w-56">Contacto</span>
              <span className="w-64">Eventos</span>
            </CrmDataListHeader>
            {result.people.map((person) => (
              <CrmDataListRow key={person.contactId}>
                <Link
                  href={`/admin/contacts/${person.contactId}`}
                  className="min-w-40 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {person.name}
                </Link>
                <span className="w-full truncate text-xs text-muted-foreground lg:w-56">
                  {[person.email, person.phoneE164]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
                <span className="flex w-full flex-wrap gap-1 lg:w-64">
                  {person.events.length > 1 ? (
                    <Badge>{person.events.length} eventos</Badge>
                  ) : null}
                  {person.events.slice(0, 3).map((e) => (
                    <Link key={e.id} href={`/admin/eventos/historial/${e.id}`}>
                      <Badge variant="outline" className="hover:bg-accent">
                        {shortDate(e.startsAt)}
                      </Badge>
                    </Link>
                  ))}
                </span>
              </CrmDataListRow>
            ))}
          </CrmDataList>
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
