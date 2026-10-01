"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarDays, Copy, Flag, Send, Users } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import CrmModal from "../CrmModal";
import CrmNewButton from "../CrmNewButton";
import CrmPageHeader from "../CrmPageHeader";
import CrmPageShell from "../CrmPageShell";
import CrmSegmentedControl from "../CrmSegmentedControl";
import { useCrm } from "../CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmField,
  CrmFormActions,
  CrmPublicLink,
  CrmRowAction,
  CrmRowActions,
  CrmRowDelete,
} from "../ui";
import FreeEventStatusBadge from "./FreeEventStatusBadge";
import ReminderProgress, { type ReminderStats } from "./ReminderProgress";
import { useFreeEventActions } from "./useFreeEventActions";

export type FreeEventStatusValue = "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";

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

type View = "proximos" | "pasados";

type Props = {
  events: FreeEventListItem[];
  initialView: View;
  /** Interruptor `free_events_editions`: sin él no se crean ni duplican. */
  editionsEnabled: boolean;
  operationalTimezone: string;
};

const NONE = "__none__";

/**
 * Los eventos gratuitos como los talleres: uno por fila, con su estado, su
 * fecha, cuántas se inscribieron y cómo van los recordatorios. Tocar la fila
 * abre el evento (página, inscritas, WhatsApp e historia).
 *
 * Como mucho tres acciones por fila (contrato R6), las que tocan según el
 * estado: un borrador se publica, duplica o borra; el publicado se ve, sus
 * inscritas y se termina; uno pasado, sus inscritas, duplicarlo o borrarlo.
 */
const FreeEventsPageClient = ({
  events,
  initialView,
  editionsEnabled,
  operationalTimezone,
}: Props) => {
  const router = useRouter();
  const { toast, canWrite } = useCrm();
  const actions = useFreeEventActions();
  const [view, setView] = useState<View>(initialView);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [headline, setHeadline] = useState("");
  const [dateKey, setDateKey] = useState("");
  const [timeHm, setTimeHm] = useState("");
  const [copyFromId, setCopyFromId] = useState<string>(events[0]?.id ?? NONE);

  const upcoming = useMemo(() => events.filter((e) => e.status !== "COMPLETED"), [events]);
  const past = useMemo(() => events.filter((e) => e.status === "COMPLETED"), [events]);
  const shown = view === "pasados" ? past : upcoming;
  const open = events.find((e) => e.status === "OPEN") ?? null;

  const changeView = (next: View) => {
    setView(next);
    router.replace(next === "pasados" ? "/admin/eventos?vista=pasados" : "/admin/eventos", { scroll: false });
  };

  const openCreate = () => {
    setHeadline("");
    setDateKey("");
    setTimeHm("");
    setCopyFromId(events[0]?.id ?? NONE);
    setCreating(true);
  };

  const create = async () => {
    if (timeHm && !dateKey) {
      toast("Indica la fecha si ya tienes una hora.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/eventos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: headline.trim() || null,
          startsAtLocal: dateKey ? { date: dateKey, time: timeHm || null } : null,
          copyFromId: copyFromId === NONE ? null : copyFromId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        webinar?: { id: string };
        message?: string;
      };
      if (!res.ok || !data.webinar) {
        toast(data.message ?? "No se pudo crear el evento.", "error");
        return;
      }
      setCreating(false);
      toast("Borrador creado", "success");
      router.push(`/admin/eventos/${data.webinar.id}?tab=pagina`);
    } finally {
      setSaving(false);
    }
  };

  const RowActions = ({ e }: { e: FreeEventListItem }) => {
    if (!canWrite) return null;
    const target = { id: e.id, headline: e.headline, registrations: e.registrations };
    const busy = actions.busyId === e.id;
    const inscritas = (
      <CrmRowAction
        icon={Users}
        label="Inscritas"
        onClick={() => router.push(`/admin/eventos/${e.id}?tab=inscritas`)}
      />
    );
    const deletable = e.registrations === 0;
    if (e.status === "OPEN") {
      return (
        <CrmRowActions>
          <CrmPublicLink href={e.publicPath} label="Ver en web" density="row" />
          {inscritas}
          <CrmRowAction icon={Flag} label="Terminar (corta inscripciones, enlace y recordatorios)" disabled={busy} onClick={() => actions.end(target)} />
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
            onClick={() => actions.publish(target, open)}
          />
          {inscritas}
          <CrmRowAction icon={Flag} label="Terminar (corta inscripciones, enlace y recordatorios)" disabled={busy} onClick={() => actions.end(target)} />
        </CrmRowActions>
      );
    }
    if (e.status === "DRAFT") {
      return (
        <CrmRowActions>
          <CrmRowAction icon={Send} label="Publicar" disabled={busy} onClick={() => actions.publish(target, open)} />
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

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Eventos gratuitos"
        description={
          open
            ? <>Publicado ahora: <strong className="font-medium text-foreground">«{open.headline}»</strong>. Cada evento tiene su página, sus inscritas y su historia.</>
            : "Ninguno publicado ahora. Cada evento tiene su página, sus inscritas y su historia."
        }
        secondaryActions={
          <CrmPublicLink
            href="/eventos-gratuitos"
            label="Ver página pública"
            copy
            disabledReason={open ? undefined : "No hay ningún evento publicado: la página da 404."}
          />
        }
        action={
          canWrite && editionsEnabled ? <CrmNewButton label="Nuevo evento" onClick={openCreate} /> : undefined
        }
        trailing={
          <CrmSegmentedControl
            aria-label="Qué eventos"
            value={view}
            onChange={changeView}
            segments={[
              { id: "proximos", label: "Próximos", count: upcoming.length },
              { id: "pasados", label: "Pasados", count: past.length },
            ]}
          />
        }
      />

      {shown.length === 0 ? (
        <CrmEmptyState
          icon={CalendarDays}
          title={view === "pasados" ? "Todavía no hay eventos pasados" : "No hay eventos próximos"}
          description={
            view === "pasados"
              ? "Cuando un evento termine, quedará aquí con sus inscritas y su historia."
              : canWrite && editionsEnabled
                ? "Crea uno con «Nuevo evento»: puedes copiar la página de uno anterior."
                : "Cuando prepares un evento aparecerá aquí."
          }
        />
      ) : (
        <CrmDataList>
          {shown.map((e) => (
            <CrmDataListRow key={e.id} actions={<RowActions e={e} />}>
              <Link href={`/admin/eventos/${e.id}`} className="block min-w-0 flex-1 py-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{e.headline}</span>
                  <FreeEventStatusBadge status={e.status} />
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {e.dateLabel} · {e.eventLabel}
                </span>
                <span className="mt-1 block text-xs">
                  <strong className="font-semibold tabular-nums text-foreground">
                    {e.registrations.toLocaleString("es-CO")}
                  </strong>{" "}
                  <span className="text-muted-foreground">
                    {e.registrations === 1 ? "inscrita" : "inscritas"}
                  </span>
                </span>
                {e.registrations > 0 && e.status !== "DRAFT" ? (
                  <ReminderProgress stats={e.stats} total={e.registrations} className="mt-1" />
                ) : null}
              </Link>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}

      <CrmModal title="Nuevo evento" open={creating} onClose={() => !saving && setCreating(false)}>
        <div className="space-y-4">
          <CrmField label="Título" description="Lo puedes cambiar después. Vacío = el de la página copiada.">
            <Input value={headline} maxLength={300} onChange={(ev) => setHeadline(ev.target.value)} />
          </CrmField>
          <div className="grid grid-cols-2 gap-3">
            <CrmField label="Fecha">
              <Input type="date" value={dateKey} onChange={(ev) => setDateKey(ev.target.value)} />
            </CrmField>
            <CrmField label="Hora" description={operationalTimezone}>
              <Input type="time" value={timeHm} onChange={(ev) => setTimeHm(ev.target.value)} />
            </CrmField>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium leading-none">Copiar la página de…</p>
            <Select value={copyFromId} onValueChange={(v) => setCopyFromId(typeof v === "string" ? v : NONE)}>
              <SelectTrigger aria-label="Copiar la página de" className="w-full">
                <SelectValue>
                  {(value) =>
                    value === NONE
                      ? "Empezar de cero"
                      : (events.find((ev) => ev.id === value)?.headline ?? "Empezar de cero")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Empezar de cero</SelectItem>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {ev.headline} · {ev.dateLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Textos, preguntas, vídeo y material. Nunca la fecha, el enlace de
              la reunión ni las inscritas.
            </p>
          </div>
          <CrmFormActions>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void create()}>
              {saving ? "Creando…" : "Crear borrador"}
            </Button>
          </CrmFormActions>
        </div>
      </CrmModal>
    </CrmPageShell>
  );
};

export default FreeEventsPageClient;
