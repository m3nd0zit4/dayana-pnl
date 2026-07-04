"use client";

import { Clock, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getContactRecents,
  saveContactRecent,
  type ContactRecentHit,
} from "@/lib/crm/contact-search-recents";

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
      className="block w-full px-3 py-2.5 text-left hover:bg-[var(--crm-linen)]/40"
      onClick={() => pick(c)}
    >
      <div className="text-sm font-medium">{contactLabel(c)}</div>
      <div className="font-mono text-[11px] text-[var(--crm-muted)]">
        {c.phoneE164}
      </div>
    </button>
  );

  const showRecents = open && q.trim().length === 0 && recents.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <label className="crm-label" htmlFor={id}>
        {label}
      </label>
      {value && selectedLabel && !open ? (
        <div className="crm-input flex items-center justify-between gap-2">
          <span className="truncate text-sm">{selectedLabel}</span>
          <button
            type="button"
            className="crm-btn-icon size-6 shrink-0"
            aria-label="Quitar contacto seleccionado"
            onClick={clear}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="crm-input flex items-center gap-2">
          <Search className="size-4 shrink-0 text-[var(--crm-muted)]" />
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
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--crm-muted)]"
            autoComplete="off"
          />
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-[var(--crm-border)] bg-white py-1 shadow-lg">
          {showRecents && (
            <>
              <p className="crm-font-display flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] text-[var(--crm-muted)]">
                <Clock className="size-3" />
                Recientes
              </p>
              {recents.map((c) => renderRow(c))}
              <div className="my-1 border-t border-[var(--crm-border)]" />
            </>
          )}
          {loading && (
            <p className="px-3 py-2 text-xs text-[var(--crm-muted)]">Buscando…</p>
          )}
          {!loading && hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--crm-muted)]">
              Sin coincidencias
            </p>
          )}
          {!loading && hits.map((c) => renderRow(c))}
        </div>
      )}
    </div>
  );
};

export default ContactPickerField;
