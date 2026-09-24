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
}: {
  people: PersonRow[];
  /** Todas las personas del filtro (no solo esta página), para «enviar a todas». */
  allContactIds: string[];
  presets: Preset[];
  kind: "evento" | "taller" | "diagnostico" | "pago" | "libre";
  title: string;
  source: string;
  allLabel: string;
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, WhatsAppStatus>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: people.map((p) => p.contactId) }),
    }).catch(() => null);
    if (res?.ok) setStatuses(((await res.json()) as { statuses: Record<string, WhatsAppStatus> }).statuses);
  }, [people]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e9edef] bg-white p-3 dark:border-border dark:bg-card">
        <span className="text-sm font-medium text-[#111b21] dark:text-foreground">WhatsApp:</span>
        <WhatsAppBulkSend
          contactIds={allContactIds}
          presets={presets}
          kind={kind}
          title={title}
          onDone={load}
          label={allLabel}
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
          />
        )}
        <span className="text-xs text-[#667781]">
          Quien escribió en las últimas 24 h recibe el mensaje gratis; al resto le llega con plantilla aprobada.
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#e9edef] bg-white dark:border-border dark:bg-card">
        <div className="flex items-center gap-3 border-b border-[#e9edef] px-3 py-2 text-xs font-medium text-[#667781] dark:border-border">
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
          <span className="hidden w-40 md:block">WhatsApp</span>
          <span className="w-28 text-right">Escribirle</span>
        </div>
        {people.map((p) => (
          <div key={p.contactId} className="flex flex-wrap items-center gap-3 border-b border-[#f0f2f5] px-3 py-2.5 last:border-0 dark:border-border">
            <input
              type="checkbox"
              aria-label={`Elegir a ${p.name}`}
              checked={selected.has(p.contactId)}
              onChange={() => toggle(p.contactId)}
              className="size-4 accent-[#00a884]"
            />
            <div className="min-w-0 flex-1">
              <Link href={`/admin/contacts/${p.contactId}`} className="block truncate text-sm font-medium hover:underline">
                {p.name}
              </Link>
              <div className="truncate text-xs text-[#667781]">{p.detail}</div>
              {p.extra}
              <div className="md:hidden">
                <WhatsAppStatusBadge status={statuses[p.contactId]} />
              </div>
            </div>
            <div className="hidden w-40 md:block">
              <WhatsAppStatusBadge status={statuses[p.contactId]} />
            </div>
            <div className="flex w-28 justify-end">
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
