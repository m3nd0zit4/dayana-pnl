"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Fuse from "fuse.js";
import { Clock, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getContactRecents,
  saveContactRecent,
  type ContactRecentHit,
} from "@/lib/crm/contact-search-recents";
import { MIN_SEARCH_TOKEN } from "@/lib/crm/search-normalize";
import { useContactSearch } from "./hooks/useContactSearch";
import { cn } from "@/lib/utils";

export type SearchContactHit = ContactRecentHit & {
  displayName: string | null;
  email: string | null;
};

type Props = {
  initialQ?: string;
  compact?: boolean;
  placeholder?: string;
  /**
   * A dónde lleva «Ver todos los resultados» / Enter. En la página de
   * Contactos conserva los filtros puestos; por defecto, sólo la búsqueda.
   */
  listHref?: (term: string) => string;
};

const SmartContactSearch = ({
  initialQ = "",
  compact = false,
  placeholder = "Buscar contacto (nombre, teléfono, email…)",
  listHref,
}: Props) => {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [recents, setRecents] = useState<ContactRecentHit[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 2 y no 1: un trigrama necesita 3 caracteres para usar el índice GIN,
  // así que consultar con una sola letra garantiza un scan por pulsación.
  const { hits, loading } = useContactSearch(q, { minLength: MIN_SEARCH_TOKEN });

  const refreshRecents = useCallback(() => {
    setRecents(getContactRecents());
  }, []);

  useEffect(() => {
    setQ(initialQ);
  }, [initialQ]);

  useEffect(() => {
    if (!compact) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compact]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fuse = useMemo(
    () =>
      new Fuse(hits, {
        keys: [
          { name: "firstName", weight: 0.35 },
          { name: "lastName", weight: 0.35 },
          { name: "displayName", weight: 0.3 },
          { name: "phoneE164", weight: 0.4 },
          { name: "email", weight: 0.25 },
        ],
        threshold: 0.38,
        ignoreLocation: true,
      }),
    [hits]
  );

  const results = useMemo(() => {
    const term = q.trim();
    if (!term) return [];
    return fuse.search(term).map((r) => r.item).slice(0, 12);
  }, [q, hits, fuse]);

  const showEmptyPanel = open && q.trim().length === 0;
  const showResultsPanel = open && q.trim().length > 0;

  const goToList = () => {
    const term = q.trim();
    router.push(
      listHref
        ? listHref(term)
        : term
          ? `/admin/contacts?q=${encodeURIComponent(term)}`
          : "/admin/contacts"
    );
    setOpen(false);
  };

  const openContact = (c: ContactRecentHit) => {
    saveContactRecent(c);
    refreshRecents();
    setOpen(false);
  };

  const renderContactRow = (c: ContactRecentHit) => (
    <Link
      key={c.id}
      href={`/admin/contacts/${c.id}`}
      className="block px-3 py-2.5 hover:bg-secondary/40"
      onClick={() => openContact(c)}
    >
      <div className="text-sm font-medium">
        {c.firstName} {c.lastName ?? ""}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        {displayContactPhone(c.phoneE164) ?? "Sin teléfono"}
      </div>
    </Link>
  );

  return (
    <div ref={wrapRef} className={`relative ${compact ? "min-w-0 flex-1" : ""}`}>
      <label
        className={
          compact
            ? "flex min-h-9 w-full items-center gap-2 rounded-lg bg-[var(--crm-topbar-accent)] px-3 transition-colors focus-within:bg-[var(--crm-topbar-accent)]/70"
            : "flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2 transition-all focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
        }
      >
        <Search
          className={cn("size-[18px] shrink-0", compact ? "text-[var(--crm-topbar-foreground)]/60" : "text-muted-foreground")}
          strokeWidth={2}
        />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            refreshRecents();
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goToList();
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm outline-none",
            compact
              ? "text-[var(--crm-topbar-foreground)] placeholder:text-[var(--crm-topbar-foreground)]/50"
              : "text-foreground placeholder:text-muted-foreground"
          )}
          autoComplete="off"
        />
        {compact && (
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-[var(--crm-topbar-foreground)]/20 px-1.5 py-0.5 font-mono text-[10px] text-[var(--crm-topbar-foreground)]/50 sm:flex">
            Ctrl K
          </kbd>
        )}
      </label>

      {showEmptyPanel && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          {recents.length > 0 && (
            <>
              <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                <Clock className="size-3" />
                Recientes
              </p>
              {recents.map((c) => renderContactRow(c))}
            </>
          )}
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Escribe nombre, teléfono o email para buscar contactos.
          </p>
        </div>
      )}

      {showResultsPanel && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>}
          {!loading && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</p>
          )}
          {results.map((c) => renderContactRow(c))}
          <button
            type="button"
            className="w-full border-t border-border px-3 py-2 text-left text-xs font-medium text-primary hover:bg-secondary/30"
            onClick={goToList}
          >
            Ver todos los resultados →
          </button>
        </div>
      )}
    </div>
  );
};

export default SmartContactSearch;
