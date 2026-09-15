"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import { Clock, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getContactRecents,
  saveContactRecent,
  type ContactRecentHit,
} from "@/lib/crm/contact-search-recents";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { useContactSearch } from "./hooks/useContactSearch";

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
  /** Lo que hay escrito en la búsqueda, para que el formulario sepa si se quedó sin elegir. */
  onQueryChange?: (query: string) => void;
};

const contactLabel = (c: PickerContact) =>
  `${c.firstName} ${c.lastName ?? ""}`.trim();

/**
 * Campo de formulario para elegir contacto con búsqueda en servidor
 * (`useContactSearch`, la misma que SmartContactSearch), en lugar de
 * descargar una lista limitada y filtrar en cliente.
 */
const ContactPickerField = ({
  id,
  label,
  value,
  onSelect,
  initialContact = null,
  required = false,
  placeholder = "Buscar por nombre, teléfono o email…",
  onQueryChange,
}: Props) => {
  const [q, setQ] = useState("");
  const [recents, setRecents] = useState<ContactRecentHit[]>([]);
  const [open, setOpen] = useState(false);
  const { hits, loading } = useContactSearch(q, { enabled: open });
  const [selectedLabel, setSelectedLabel] = useState(
    initialContact?.label ?? ""
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * El desplegable se pinta en un portal con posicion fija, no en el flujo.
   *
   * Antes iba en flujo con `max-h-72`, y su comentario explicaba por que: uno
   * flotante se recortaba contra el borde del modal. El precio de esa solucion
   * era que **metia 288px dentro del modal en cuanto enfocabas el campo**, y
   * eso es lo que hacia que el formulario de enlaces se estirase hasta tener
   * que hacer scroll.
   *
   * Mismo tratamiento que `CheckoutCountrySelect`: portal a `document.body`,
   * medido contra el disparador y volteando hacia arriba cuando no cabe
   * debajo. Asi no se recorta Y no empuja a nadie.
   */
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (wrapRef.current && !wrapRef.current.contains(target)) {
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
    onQueryChange?.("");
    setOpen(false);
    onSelect(c);
  };

  const clear = () => {
    setSelectedLabel("");
    setQ("");
    onQueryChange?.("");
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

  const PANEL_GAP = 4;
  const PANEL_MAX = 288;

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - PANEL_GAP;
    const above = rect.top - PANEL_GAP;
    const openUp = below < 180 && above > below;
    setPos({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(140, Math.min(PANEL_MAX, openUp ? above : below)),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, []);

  useLayoutEffect(() => {
    // Medir y colocar antes de pintar: hacerlo despues deja ver el panel
    // saltando desde la esquina. `CheckoutCountrySelect` hace lo mismo.
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => updatePosition();
    window.addEventListener("resize", onMove);
    // `true`: el modal scrollea en su propio contenedor, no en la ventana.
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, updatePosition]);

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
              onQueryChange?.(e.target.value);
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

      {open && pos && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.top !== undefined ? { top: pos.top } : {}),
            ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
          }}
          className="z-50 overflow-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
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
        </div>,
        document.body
      )
        : null}
    </div>
  );
};

export default ContactPickerField;
