"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarDays, Copy, Flag, Send, Users } from "lucide-react";
import { useCrm } from "../CrmProvider";
import { CrmPublicLink, CrmRowAction, CrmRowActions, CrmRowDelete } from "../ui";
import EditionsListShell, { type EditionRowView, type EditionsView } from "../editions/EditionsListShell";
import NewEditionModal, { type NewEditionValues } from "../editions/NewEditionModal";
import type { EditionStatus } from "../editions/status";
import { useEditionActions } from "../editions/useEditionActions";
import { FREE_EVENT_ACTIONS } from "./actions-config";
import ReminderProgress, { type ReminderStats } from "./ReminderProgress";

export type FreeEventStatusValue = EditionStatus;

/** Una fila de la lista, ya lista para cruzar al cliente. */
export type FreeEventListItem = {
  id: string;
  headline: string;
  eventLabel: string;
  status: FreeEventStatusValue;
  publicPath: string;
  dateLabel: string;
  registrations: number;
  stats: ReminderStats;
};

type Props = {
  events: FreeEventListItem[];
  initialView: EditionsView;
  /** Interruptor `free_events_editions`: sin él no se crean ni duplican. */
  editionsEnabled: boolean;
  operationalTimezone: string;
};

/**
 * Los eventos gratuitos como los talleres: uno por fila, con su estado, su
 * fecha, cuántas se inscribieron y cómo van los recordatorios. Tocar la fila
 * abre el evento (página, inscritas, WhatsApp e historia).
 *
 * Como mucho tres acciones por fila (contrato R6), las que tocan según el
 * estado: un borrador se publica, duplica o borra; el publicado se ve, sus
 * inscritas y se termina; uno pasado, sus inscritas, duplicarlo o borrarlo.
 */
const FreeEventsPageClient = ({ events, initialView, editionsEnabled, operationalTimezone }: Props) => {
  const router = useRouter();
  const { canWrite, toast } = useCrm();
  const actions = useEditionActions(FREE_EVENT_ACTIONS);
  const [creating, setCreating] = useState(false);

  const open = events.find((e) => e.status === "OPEN") ?? null;
  const openOther = open ? { id: open.id, title: open.headline } : null;

  const RowActions = ({ e }: { e: FreeEventListItem }) => {
    if (!canWrite) return null;
    const target = { id: e.id, key: e.id, title: e.headline, registrations: e.registrations };
    const busy = actions.busyId === e.id;
    const inscritas = (
      <CrmRowAction icon={Users} label="Inscritas" onClick={() => router.push(`/admin/eventos/${e.id}?tab=inscritas`)} />
    );
    const deletable = e.registrations === 0;
    if (e.status === "OPEN") {
      return (
        <CrmRowActions>
          <CrmPublicLink href={e.publicPath} label="Ver página pública" density="row" />
          {inscritas}
          <CrmRowAction
            icon={Flag}
            label="Terminar (corta inscripciones, enlace y recordatorios)"
            disabled={busy}
            onClick={() => actions.end(target)}
          />
        </CrmRowActions>
      );
    }
    if (e.status === "CLOSED") {
      return (
        <CrmRowActions>
          <CrmRowAction
            icon={Send}
            label="Publicar otra vez (abrir inscripciones)"
            disabled={busy}
            onClick={() => actions.publish(target, openOther)}
          />
          {inscritas}
          <CrmRowAction
            icon={Flag}
            label="Terminar (corta inscripciones, enlace y recordatorios)"
            disabled={busy}
            onClick={() => actions.end(target)}
          />
        </CrmRowActions>
      );
    }
    if (e.status === "DRAFT") {
      return (
        <CrmRowActions>
          <CrmRowAction icon={Send} label="Publicar" disabled={busy} onClick={() => actions.publish(target, openOther)} />
          {editionsEnabled ? (
            <CrmRowAction icon={Copy} label="Duplicar" disabled={busy} onClick={() => actions.duplicate(target)} />
          ) : null}
          {deletable ? <CrmRowDelete disabled={busy} onClick={() => actions.remove(target)} /> : null}
        </CrmRowActions>
      );
    }
    return (
      <CrmRowActions>
        {inscritas}
        {editionsEnabled ? (
          <CrmRowAction icon={Copy} label="Duplicar" disabled={busy} onClick={() => actions.duplicate(target)} />
        ) : null}
        {deletable ? <CrmRowDelete disabled={busy} onClick={() => actions.remove(target)} /> : null}
      </CrmRowActions>
    );
  };

  const toRow = (e: FreeEventListItem): EditionRowView => ({
    id: e.id,
    href: `/admin/eventos/${e.id}`,
    title: e.headline,
    status: e.status,
    actions: <RowActions e={e} />,
    details: (
      <>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {e.dateLabel} · {e.eventLabel}
        </span>
        <span className="mt-1 block text-xs">
          <strong className="font-semibold tabular-nums text-foreground">
            {e.registrations.toLocaleString("es-CO")}
          </strong>{" "}
          <span className="text-muted-foreground">{e.registrations === 1 ? "inscrita" : "inscritas"}</span>
        </span>
        {e.registrations > 0 && e.status !== "DRAFT" ? (
          <ReminderProgress stats={e.stats} total={e.registrations} className="mt-1" />
        ) : null}
      </>
    ),
  });

  const upcoming = useMemo(() => events.filter((e) => e.status !== "COMPLETED"), [events]);
  const past = useMemo(() => events.filter((e) => e.status === "COMPLETED"), [events]);

  const create = async (v: NewEditionValues): Promise<string | null> => {
    const res = await fetch("/api/admin/eventos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headline: v.title || null,
        startsAtLocal: v.dateKey ? { date: v.dateKey, time: v.timeHm || null } : null,
        copyFromId: v.copyFromId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { webinar?: { id: string }; message?: string };
    if (!res.ok || !data.webinar) return data.message ?? "No se pudo crear el evento.";
    setCreating(false);
    toast("Borrador creado", "success");
    router.push(`/admin/eventos/${data.webinar.id}?tab=pagina`);
    return null;
  };

  return (
    <EditionsListShell
      title="Eventos gratuitos"
      description={
        open ? (
          <>
            Publicado ahora: <strong className="font-medium text-foreground">«{open.headline}»</strong>. Cada evento
            tiene su página, sus inscritas y su historia.
          </>
        ) : (
          "Ninguno publicado ahora. Cada evento tiene su página, sus inscritas y su historia."
        )
      }
      secondaryActions={
        <CrmPublicLink
          href="/eventos-gratuitos"
          label="Ver página pública"
          copy
          disabledReason={open ? undefined : "No hay ningún evento publicado: la página da 404."}
        />
      }
      newLabel={canWrite && editionsEnabled ? "Nuevo evento" : undefined}
      onNew={() => setCreating(true)}
      basePath="/admin/eventos"
      viewsAriaLabel="Qué eventos"
      initialView={initialView}
      upcoming={upcoming.map(toRow)}
      past={past.map(toRow)}
      icon={CalendarDays}
      empty={{
        upcoming: "No hay eventos próximos",
        upcomingDescription:
          canWrite && editionsEnabled
            ? "Crea uno con «Nuevo evento»: puedes copiar la página de uno anterior."
            : "Cuando prepares un evento aparecerá aquí.",
        past: "Todavía no hay eventos pasados",
        pastDescription: "Cuando un evento termine, quedará aquí con sus inscritas y su historia.",
      }}
    >
      <NewEditionModal
        open={creating}
        onClose={() => setCreating(false)}
        heading="Nuevo evento"
        titleDescription="Lo puedes cambiar después. Vacío = el de la página copiada."
        sources={events.map((e) => ({ id: e.id, title: e.headline, label: `${e.headline} · ${e.dateLabel}` }))}
        defaultSourceId={events[0]?.id ?? null}
        copyHint="Textos, preguntas, video y material. Nunca la fecha, el enlace de la reunión ni las inscritas."
        titleMaxLength={300}
        operationalTimezone={operationalTimezone}
        onCreate={create}
      />
    </EditionsListShell>
  );
};

export default FreeEventsPageClient;
