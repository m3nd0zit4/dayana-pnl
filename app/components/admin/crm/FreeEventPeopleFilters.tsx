"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CrmSegmentedControl from "./CrmSegmentedControl";
import { CrmFilterBar, CrmSearchInput } from "./ui";

/**
 * Controles de «Inscritas»: qué evento se mira y la búsqueda. Todo vive en la
 * URL (`?evento=…&q=…`), así una recarga o un enlace compartido muestran lo
 * mismo, y la página sigue siendo de servidor.
 */

const BASE = "/admin/eventos/inscritas";
const ALL = "todos";

const hrefFor = (eventId: string | null, q: string) => {
  const params = new URLSearchParams();
  if (eventId) params.set("evento", eventId);
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return `${BASE}${qs ? `?${qs}` : ""}`;
};

export type FreeEventSegment = { id: string; label: string; count?: number };

/**
 * Pestañas de evento: «Todos», luego el actual y después los anteriores. Con
 * muchos eventos la fila se desplaza en horizontal en vez de empujar la página.
 */
export const FreeEventSwitcher = ({
  segments,
  value,
  q,
}: {
  segments: FreeEventSegment[];
  value: string | null;
  q: string;
}) => {
  const router = useRouter();
  // Se marca al tocar, sin esperar a que llegue la página nueva.
  const [selected, setSelected] = useState(value ?? ALL);
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <CrmSegmentedControl
        aria-label="Evento"
        segments={[{ id: ALL, label: "Todos" }, ...segments]}
        value={selected}
        onChange={(id) => {
          setSelected(id);
          router.push(hrefFor(id === ALL ? null : id, q), { scroll: false });
        }}
      />
    </div>
  );
};

/** Búsqueda: filtra al escribir (R10), sin botón. */
export const FreeEventPeopleSearch = ({
  eventId,
  q,
}: {
  eventId: string | null;
  q: string;
}) => {
  const router = useRouter();
  const [value, setValue] = useState(q);

  useEffect(() => {
    if (value.trim() === q) return;
    const id = setTimeout(
      () => router.replace(hrefFor(eventId, value), { scroll: false }),
      350
    );
    return () => clearTimeout(id);
  }, [value, q, eventId, router]);

  return (
    <CrmFilterBar>
      <CrmSearchInput
        value={value}
        onChange={setValue}
        placeholder="Nombre, correo o teléfono"
      />
    </CrmFilterBar>
  );
};
