"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import { Clock, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getContactRecents,
  saveContactRecent,
  type ContactRecentHit,
} from "@/lib/crm/contact-search-recents";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";

export type PickerContact = ContactRecentHit & {
  displayName?: string | null;
  email?: string | null;
};

type Props = {
  id: string;
  label: string;
  value: string;
  onSelect: (contact: PickerContact | null) => void;
  initialContact?: { id: string; label: string } | null;
  required?: boolean;
  placeholder?: string;
};

const contactLabel = (c: PickerContact) =>
  `${c.firstName} ${c.lastName ?? ""}`.trim();

/**
 * Campo de formulario para elegir contacto con búsqueda en servidor
 * (mismo patrón que SmartContactSearch: debounce 350ms + AbortController),
 * en lugar de descargar una lista limitada y filtrar en cliente.
 */
const ContactPickerField = ({
  id,
  label,
  value,
  onSelect,
  initialContact = null,
  required = false,
  placeholder = "Buscar por nombre, teléfono o email…",
}: Props) => {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickerContact[]>([]);
  const [recents, setRecents] = useState<ContactRecentHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(
    initialContact?.label ?? ""
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchContacts = useCallback(async (term: string, signal: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (term.trim()) params.set("q", term.trim());
      params.set("limit", "25");
      const res = await fetch(`/api/admin/contacts/search?${params}`, { signal });
      const data = (await res.json()) as { contacts?: PickerContact[] };
      setHits(data.contacts ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void fetchContacts(q, controller.signal);
    }, 350);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [q, open, fetchContacts]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c: PickerContact) => {
    saveContactRecent({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phoneE164: c.phoneE164,
    });
    setSelectedLabel(contactLabel(c));
    setQ("");
    setOpen(false);
    onSelect(c);
  };

  const clear = () => {
    setSelectedLabel("");
    setQ("");
    onSelect(null);
  };

  const renderRow = (c: PickerContact) => (
    <button
      key={c.id}
      type="button"
      className="block w-full px-3 py-2.5 text-left hover:bg-muted/50"
      onClick={() => pick(c)}
    >
      <div className="text-sm font-medium">{contactLabel(c)}</div>
      <div className="font-mono text-[11px] text-muted-foreground">
        {displayContactPhone(c.phoneE164) ?? "Sin teléfono"}
      </div>
    </button>
  );

  const showRecents = open && q.trim().length === 0 && recents.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <Label htmlFor={id}>{label}</Label>
      {value && selectedLabel && !open ? (
        <div className="mt-1.5 flex h-9 items-center justify-between gap-2 rounded-lg border border-input px-2.5">
          <span className="truncate text-sm">{selectedLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="Quitar contacto seleccionado"
            onClick={clear}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex h-9 items-center gap-2 rounded-lg border border-input px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            id={id}
            type="search"
            value={q}
            required={required && !value}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setRecents(getContactRecents());
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
          />
        </div>
      )}

      {open && (
        // En flujo (no absolute): dentro de un modal con overflow, un
        // dropdown flotante se recorta en el borde — así el modal crece.
        <div className="mt-1 max-h-72 overflow-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
          {showRecents && (
            <>
              <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                <Clock className="size-3" />
                Recientes
              </p>
              {recents.map((c) => renderRow(c))}
              <div className="my-1 border-t border-border" />
            </>
          )}
          {loading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>
          )}
          {!loading && hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</p>
          )}
          {!loading && hits.map((c) => renderRow(c))}
        </div>
      )}
    </div>
  );
};

export default ContactPickerField;
