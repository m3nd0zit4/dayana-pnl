"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WhatsAppStatus } from "@/lib/crm/whatsapp-outbound";
import type { Preset } from "@/lib/crm/whatsapp-presets";
import { SendWhatsAppButton } from "./SendWhatsAppDialog";
import WhatsAppBulkSend from "./WhatsAppBulkSend";
import WhatsAppStatusBadge from "./WhatsAppStatusBadge";

export type PersonRow = {
  contactId: string;
  name: string;
  detail: string;
  extra?: React.ReactNode;
};

/**
 * Una lista de personas con WhatsApp: casillas para elegir, envío a las
 * elegidas o a todas, y por persona su estado (enviado, leído, respondió) y
 * un botón para escribirle solo a ella. La usan inscritas de eventos, alumnas
 * de talleres y diagnósticos.
 */
const PeopleWhatsAppList = ({
  people,
  allContactIds,
  presets,
  kind,
  title,
  source,
  allLabel,
  link,
  initialStatuses,
  timeZone,
}: {
  people: PersonRow[];
  /** Todas las personas del filtro (no solo esta página), para «enviar a todas». */
  allContactIds: string[];
  presets: Preset[];
  kind: "evento" | "taller" | "diagnostico" | "pago" | "libre" | "comunidad";
  title: string;
  source: string;
  allLabel: string;
  /** El evento o el taller de los envíos masivos: quedan en su historia. */
  link?: { freeWebinarId?: string | null; workshopEditionId?: string | null };
  /**
   * El estado de WhatsApp de `people`, ya leído en el servidor con
   * `whatsAppStatusFor` (el mismo que usa la ruta de estado). Con él la
   * columna sale bien desde el primer pintado; sin él, se pide al montar.
   */
  initialStatuses?: Record<string, WhatsAppStatus> | null;
  /** Zona de las horas del estado. Obligatoria con `initialStatuses`. */
  timeZone?: string;
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, WhatsAppStatus>>({});
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  const fetchStatuses = useCallback(
    (): Promise<Record<string, WhatsAppStatus> | null> =>
      fetch("/api/admin/whatsapp/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: people.map((p) => p.contactId) }),
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ statuses?: Record<string, WhatsAppStatus> }>) : null))
        .then((body) => body?.statuses ?? null)
        .catch(() => null),
    [people]
  );

  const apply = useCallback((next: Record<string, WhatsAppStatus> | null) => {
    if (next) {
      setStatuses(next);
      setLoadState("ready");
    } else {
      // Si no se pudo, lo que ya se sabía se queda; lo que no, «—» (no
      // «Sin WhatsApp», que sería afirmar algo que no sabemos).
      setLoadState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  const load = useCallback(async () => apply(await fetchStatuses()), [fetchStatuses, apply]);

  useEffect(() => {
    let alive = true;
    void fetchStatuses().then((next) => {
      if (alive) apply(next);
    });
    return () => {
      alive = false;
    };
  }, [fetchStatuses, apply]);

  // Lo recién pedido manda; mientras llega, lo que vino del servidor.
  const statusOf = (id: string) => statuses[id] ?? initialStatuses?.[id];
  const pending = initialStatuses || loadState === "ready" ? undefined : loadState;

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allOnPage = people.length > 0 && people.every((p) => selected.has(p.contactId));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <span className="text-sm font-medium text-foreground">WhatsApp:</span>
        <WhatsAppBulkSend
          contactIds={allContactIds}
          presets={presets}
          kind={kind}
          title={title}
          onDone={load}
          label={allLabel}
          link={link}
        />
        {selected.size > 0 && (
          <WhatsAppBulkSend
            contactIds={selectedIds}
            presets={presets}
            kind={kind}
            title={title}
            onDone={() => {
              setSelected(new Set());
              void load();
            }}
            label="Enviar a las elegidas"
            link={link}
          />
        )}
        <span className="text-xs text-muted-foreground">
          Quien escribió en las últimas 24 h recibe el mensaje gratis; al resto le llega con plantilla aprobada.
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Elegir todas las de esta página"
            checked={allOnPage}
            onChange={() =>
              setSelected((s) => {
                const next = new Set(s);
                if (allOnPage) people.forEach((p) => next.delete(p.contactId));
                else people.forEach((p) => next.add(p.contactId));
                return next;
              })
            }
            className="size-4 accent-[#00a884]"
          />
          <span className="flex-1">Persona</span>
          {/* Ancho para «Enviado, aún no le llega · 4 oct, 4:16 a. m.» en una línea. */}
          <span className="hidden w-60 shrink-0 md:block xl:w-72">WhatsApp</span>
          <span className="w-28 shrink-0 text-right">Escribirle</span>
        </div>
        {people.map((p) => (
          <div key={p.contactId} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
            <input
              type="checkbox"
              aria-label={`Elegir a ${p.name}`}
              checked={selected.has(p.contactId)}
              onChange={() => toggle(p.contactId)}
              className="size-4 shrink-0 accent-[#00a884]"
            />
            <div className="min-w-0 flex-1">
              <Link href={`/admin/contacts/${p.contactId}`} className="block truncate text-sm font-medium hover:underline">
                {p.name}
              </Link>
              <div className="truncate text-xs text-muted-foreground">{p.detail}</div>
              {p.extra}
              {/* En el teléfono, el estado va debajo de la persona. */}
              <div className="mt-0.5 flex min-w-0 md:hidden">
                <WhatsAppStatusBadge status={statusOf(p.contactId)} pending={pending} timeZone={timeZone} />
              </div>
            </div>
            <div className="hidden w-60 min-w-0 shrink-0 md:flex xl:w-72">
              <WhatsAppStatusBadge status={statusOf(p.contactId)} pending={pending} timeZone={timeZone} />
            </div>
            <div className="flex w-28 shrink-0 justify-end">
              <SendWhatsAppButton
                small
                label="Enviar"
                contactId={p.contactId}
                name={p.name}
                presets={presets}
                source={source}
                onSent={load}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PeopleWhatsAppList;
