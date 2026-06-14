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
  /** Ancho mínimo del menú (evita truncar etiquetas largas). */
  panelMinWidth?: number;
  /** Estilo compacto tipo badge para selectores de estado en filas. */
  menuVariant?: "default" | "status";
};

const PANEL_Z = 110;
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
  panelMinWidth,
  menuVariant = "default",
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

    const width = Math.max(rect.width, panelMinWidth ?? 0);

    setPosition({
      left: rect.left,
      width,
      maxHeight,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, [showSearch, allowEmpty, panelMinWidth]);

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
    setOpen(false);
    setQuery("");
    if (next !== value) onChange(next);
  };

  const renderOption = (o: SearchableSelectOption) => (
    <li key={o.value}>
      <button
        type="button"
        role="option"
        aria-selected={value === o.value}
        className={`crm-searchable-option${value === o.value ? " is-selected" : ""}`}
        onClick={() => pick(o.value)}
      >
        <span>{o.label}</span>
        {o.hint && <span className="crm-searchable-option-hint">{o.hint}</span>}
      </button>
    </li>
  );

  let lastGroup: string | undefined;

  const panel =
    open && position ? (
      <div
        ref={panelRef}
        className={`crm-searchable-panel${
          menuVariant === "status" ? " crm-searchable-panel--status" : ""
        }`}
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
          <div className="crm-searchable-panel-search">
            <Search className="size-4 shrink-0 text-[var(--crm-muted)]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
            />
          </div>
        )}
        <ul
          className="crm-searchable-panel-list crm-no-scrollbar"
          role="listbox"
          style={{ maxHeight: position.maxHeight }}
        >
          {allowEmpty && (
            <li>
              <button
                type="button"
                role="option"
                className="crm-searchable-option crm-searchable-option--empty"
                onClick={() => pick("")}
              >
                {emptyLabel}
              </button>
            </li>
          )}
          {query.trim() !== "" && filtered.length === 0 && (
            <li className="crm-searchable-empty">Sin coincidencias</li>
          )}
          {listOptions.flatMap((o, i) => {
            const nodes: React.ReactNode[] = [];
            if (query.trim() === "" && o.group && o.group !== lastGroup) {
              lastGroup = o.group;
              nodes.push(
                <li key={`g-${o.group}-${i}`} className="crm-searchable-group-label">
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
                  <div className="crm-searchable-divider" />
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
        className={`crm-searchable-trigger${
          menuVariant === "status" ? " crm-searchable-trigger--status" : ""
        }${open ? " is-open" : ""}${buttonClassName ? ` ${buttonClassName}` : ""}`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span
          className={`crm-searchable-trigger-label${
            !value && allowEmpty ? " is-placeholder" : ""
          }`}
        >
          {display}
        </span>
        <ChevronDown className="crm-searchable-trigger-chevron" aria-hidden />
      </button>

      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </div>
  );
};

export default SearchableSelect;
