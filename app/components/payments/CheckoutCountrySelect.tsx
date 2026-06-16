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
import {
  COUNTRY_OPTIONS_GROUPED,
  formatCountryLabel,
  getCountryByIso,
  PRIORITY_COUNTRY_COUNT,
} from "@/lib/countries";

const PANEL_Z = 120;
const PANEL_GAP = 4;
const LIST_MAX_HEIGHT = 260;
const SEARCH_BAR_HEIGHT = 44;

type Props = {
  id?: string;
  label?: string;
  value: string;
  onChange: (iso2: string) => void;
  disabled?: boolean;
};

const CheckoutCountrySelect = ({
  id: idProp,
  label = "País del número",
  value,
  onChange,
  disabled = false,
}: Props) => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    listHeight: number;
  } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () =>
      COUNTRY_OPTIONS_GROUPED().map((c) => ({
        value: c.iso2,
        label: c.name,
        hint: c.dialCode,
      })),
    []
  );

  const selected = getCountryByIso(value);
  const display = selected
    ? `${selected.name} (${selected.dialCode})`
    : value
      ? formatCountryLabel(value)
      : "Selecciona un país";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.hint.toLowerCase().includes(q) ||
        o.hint.replace("+", "").includes(q.replace("+", ""))
    );
  }, [options, query]);

  const listOptions = query.trim() ? filtered : options;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = LIST_MAX_HEIGHT + SEARCH_BAR_HEIGHT;
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP;
    const spaceAbove = rect.top - PANEL_GAP;
    const openUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const listHeight = Math.max(
      140,
      Math.min(
        LIST_MAX_HEIGHT,
        openUp ? spaceAbove - PANEL_GAP - SEARCH_BAR_HEIGHT : spaceBelow - PANEL_GAP - SEARCH_BAR_HEIGHT
      )
    );

    setPosition({
      left: rect.left,
      width: rect.width,
      listHeight,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, []);

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

  const panel =
    open && position ? (
      <div
        ref={panelRef}
        className="checkout-country-panel rounded-lg border border-linen/20 bg-ink shadow-[0_16px_48px_rgba(0,0,0,0.55)] flex flex-col overflow-hidden"
        style={{
          position: "fixed",
          left: position.left,
          width: position.width,
          top: position.top,
          bottom: position.bottom,
          zIndex: PANEL_Z,
          height: position.listHeight + SEARCH_BAR_HEIGHT,
        }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-linen/15 px-3 py-2 h-11">
          <Search className="size-4 shrink-0 text-white/40" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar país o prefijo…"
            autoFocus
            className="w-full bg-transparent font-[font1] text-sm text-white placeholder:text-white/35 outline-none"
          />
        </div>
        <ul
          className="checkout-country-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y py-1"
          role="listbox"
          style={{ height: position.listHeight, maxHeight: position.listHeight }}
        >
          {query.trim() !== "" && filtered.length === 0 && (
            <li className="px-3 py-2 font-[font1] text-sm text-white/45">
              Sin coincidencias
            </li>
          )}
          {listOptions.map((o, i) => (
            <li key={o.value}>
              {query.trim() === "" && i === PRIORITY_COUNTRY_COUNT ? (
                <div className="my-1 border-t border-linen/10" aria-hidden />
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-[font1] text-sm transition-colors ${
                  value === o.value
                    ? "bg-linen/15 text-linen"
                    : "text-white/85 hover:bg-white/5"
                }`}
                onClick={() => pick(o.value)}
              >
                <span className="truncate">{o.label}</span>
                <span className="shrink-0 font-mono text-xs text-white/45">
                  {o.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className="block">
      <span className="font-[font1] text-xs text-white/50 mb-1 block">{label}</span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-linen/20 bg-black/40 px-3 py-2.5 text-left font-[font1] text-sm text-white transition-colors disabled:opacity-50 ${
          open ? "border-linen/40 ring-1 ring-linen/20" : ""
        }`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="truncate">{display}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-white/45 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}

      <style jsx global>{`
        .checkout-country-list {
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: rgba(236, 227, 212, 0.45) rgba(255, 255, 255, 0.06);
        }
        .checkout-country-list::-webkit-scrollbar {
          width: 8px;
        }
        .checkout-country-list::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.06);
          border-radius: 999px;
          margin: 4px 0;
        }
        .checkout-country-list::-webkit-scrollbar-thumb {
          background: rgba(236, 227, 212, 0.45);
          border-radius: 999px;
        }
        .checkout-country-list::-webkit-scrollbar-thumb:hover {
          background: rgba(236, 227, 212, 0.65);
        }
      `}</style>
    </div>
  );
};

export default CheckoutCountrySelect;
