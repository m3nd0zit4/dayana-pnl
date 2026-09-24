"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Input } from "@/app/components/ui/input";
import {
  WHATSAPP_SETTINGS_TABS,
  searchWhatsAppSettings,
  type WhatsAppSettingEntry,
} from "@/lib/crm/whatsapp-settings-registry";
import { cn } from "@/lib/utils";

const TAB_LABEL = Object.fromEntries(WHATSAPP_SETTINGS_TABS.map((t) => [t.id, t.label]));

/**
 * «¿Dónde se cambia…?» Escribe una palabra y lleva directo al ajuste: cambia
 * de pestaña y lo resalta.
 */
const SettingsSearch = ({ onPick }: { onPick: (entry: WhatsAppSettingEntry) => void }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => searchWhatsAppSettings(query).slice(0, 8), [query]);

  const pick = (entry: WhatsAppSettingEntry) => {
    onPick(entry);
    setQuery("");
    setOpen(false);
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Buscar un ajuste"
        placeholder="Buscar un ajuste: citas, horario…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
        className="h-9 pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => setQuery("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 z-30 mt-1 max-h-80 w-full sm:w-96 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">No encontré ese ajuste. Prueba con otra palabra.</li>
          ) : (
            results.map((entry, i) => (
              <li key={entry.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(entry)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm",
                    i === active && "bg-accent text-accent-foreground"
                  )}
                >
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{TAB_LABEL[entry.tab]}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default SettingsSearch;
