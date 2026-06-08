"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

import type { SelectOption } from "@/lib/crm/select-option";

export type SearchableSelectOption = SelectOption;

type PanelPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

type Props = {
  id?: string;
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  hideLabel?: boolean;
  buttonClassName?: string;
  /** Línea divisoria tras N opciones (ej. países frecuentes). */
  priorityCount?: number;
  /** Mostrar búsqueda si hay al menos N opciones. */
  searchMinOptions?: number;
};

const PANEL_Z = 60;
const PANEL_GAP = 4;
const PANEL_MIN_HEIGHT = 120;
const LIST_MAX_HEIGHT = 224;

const SearchableSelect = ({
  id: idProp,
  label,
  value,
  options,
  onChange,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  allowEmpty = false,
  emptyLabel = "Sin selección",
  required = false,
  disabled = false,
  className = "",
  hideLabel = false,
  buttonClassName = "",
  priorityCount,
  searchMinOptions = 8,
}: Props) => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const display =
    !value && allowEmpty
      ? emptyLabel
      : selected?.label ?? (value || placeholder);

  const showSearch = options.length >= searchMinOptions;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.hint?.toLowerCase().includes(q) ||
        o.group?.toLowerCase().includes(q)
    );
  }, [options, query]);

  const listOptions = query.trim() ? filtered : options;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = Math.min(
      LIST_MAX_HEIGHT + (showSearch ? 44 : 0) + (allowEmpty ? 36 : 0),
      280
    );
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP;
    const spaceAbove = rect.top - PANEL_GAP;
    const openUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      PANEL_MIN_HEIGHT,
      Math.min(LIST_MAX_HEIGHT, openUp ? spaceAbove - PANEL_GAP : spaceBelow - PANEL_GAP)
    );

    setPosition({
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, [showSearch, allowEmpty]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  const renderOption = (o: SearchableSelectOption) => (
    <li key={o.value}>
      <button
        type="button"
        role="option"
        aria-selected={value === o.value}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--crm-linen)]/50 ${
          value === o.value ? "bg-[var(--crm-accent-soft)]" : ""
        }`}
        onClick={() => pick(o.value)}
      >
        <span className="min-w-0 truncate">{o.label}</span>
        {o.hint && (
          <span className="shrink-0 font-mono text-xs text-[var(--crm-muted)]">
            {o.hint}
          </span>
        )}
      </button>
    </li>
  );

  let lastGroup: string | undefined;

  const panel =
    open && position ? (
      <div
        ref={panelRef}
        className="overflow-hidden rounded-xl border border-[var(--crm-border)] bg-white shadow-lg"
        style={{
          position: "fixed",
          left: position.left,
          width: position.width,
          top: position.top,
          bottom: position.bottom,
          zIndex: PANEL_Z,
        }}
      >
        {showSearch && (
          <div className="flex items-center gap-2 border-b border-[var(--crm-border)] px-3 py-2">
            <Search className="size-4 shrink-0 text-[var(--crm-muted)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              autoFocus
            />
          </div>
        )}
        <ul
          className="crm-no-scrollbar overflow-y-auto py-1"
          role="listbox"
          style={{ maxHeight: position.maxHeight }}
        >
          {allowEmpty && (
            <li>
              <button
                type="button"
                role="option"
                className="w-full px-3 py-2 text-left text-sm text-[var(--crm-muted)] hover:bg-[var(--crm-linen)]/50"
                onClick={() => pick("")}
              >
                {emptyLabel}
              </button>
            </li>
          )}
          {query.trim() !== "" && filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-[var(--crm-muted)]">
              Sin coincidencias
            </li>
          )}
          {listOptions.flatMap((o, i) => {
            const nodes: React.ReactNode[] = [];
            if (query.trim() === "" && o.group && o.group !== lastGroup) {
              lastGroup = o.group;
              nodes.push(
                <li
                  key={`g-${o.group}-${i}`}
                  className="crm-font-display px-3 pb-1 pt-2 text-[10px] text-[var(--crm-muted)]"
                >
                  {o.group}
                </li>
              );
            }
            if (
              query.trim() === "" &&
              priorityCount != null &&
              priorityCount > 0 &&
              i === priorityCount
            ) {
              nodes.push(
                <li key={`div-${i}`} aria-hidden>
                  <div className="my-1 border-t border-[var(--crm-border)]" />
                </li>
              );
            }
            nodes.push(renderOption(o));
            return nodes;
          })}
        </ul>
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {!hideLabel && (
        <label className="crm-label" htmlFor={id}>
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required || undefined}
        className={`crm-select flex w-full items-center justify-between gap-2 text-left disabled:opacity-50 ${buttonClassName}`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span
          className={`min-w-0 truncate ${!value && allowEmpty ? "text-[var(--crm-muted)]" : ""}`}
        >
          {display}
        </span>
        <ChevronDown className="size-4 shrink-0 text-[var(--crm-muted)]" />
      </button>

      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </div>
  );
};

export default SearchableSelect;
