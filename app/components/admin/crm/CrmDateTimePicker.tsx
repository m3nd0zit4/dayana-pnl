"use client";

import { CalendarDays } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import {
  formatDateTimeShortEs,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  pad2,
  parseDateTimeLocal,
  toDateTimeLocal,
} from "@/lib/crm/datetime-local";

type PanelPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
};

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

const PANEL_Z = 110;
const PANEL_GAP = 6;

const CrmDateTimePicker = ({
  id: idProp,
  value,
  onChange,
  disabled = false,
  className = "",
  placeholder = "dd/mm/aaaa, hh:mm",
}: Props) => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const parsed = parseDateTimeLocal(value);
  const [date, setDate] = useState<Date>(() => parsed?.date ?? new Date());
  const [hour, setHour] = useState(() => parsed?.hour ?? 10);
  const [minute, setMinute] = useState(() => parsed?.minute ?? 0);

  useEffect(() => {
    const p = parseDateTimeLocal(value);
    if (p) {
      setDate(p.date);
      setHour(p.hour);
      setMinute(Math.round(p.minute / 5) * 5 % 60);
    }
  }, [value]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panelHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP;
    const spaceAbove = rect.top - PANEL_GAP;
    const openUp = spaceBelow < panelHeight && spaceAbove > spaceBelow;
    const width = Math.min(Math.max(rect.width, 300), 360);

    setPosition({
      left: Math.min(rect.left, window.innerWidth - width - 8),
      width,
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
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const emit = (d: Date, h: number, m: number) => {
    onChange(toDateTimeLocal(d, h, m));
  };

  const pickDate = (next: Date) => {
    setDate(next);
    emit(next, hour, minute);
  };

  const pickHour = (h: number) => {
    setHour(h);
    emit(date, h, minute);
  };

  const pickMinute = (m: number) => {
    setMinute(m);
    emit(date, hour, m);
  };

  const setToday = () => {
    const now = new Date();
    setDate(now);
    const roundedMin = Math.round(now.getMinutes() / 5) * 5;
    const m = roundedMin === 60 ? 0 : roundedMin;
    const h = roundedMin === 60 ? (now.getHours() + 1) % 24 : now.getHours();
    setHour(h);
    setMinute(m);
    emit(now, h, m);
  };

  const clear = () => {
    onChange("");
    setOpen(false);
  };

  const panel =
    open && position ? (
      <div
        ref={panelRef}
        className="crm-datetime-popover"
        role="dialog"
        aria-label="Seleccionar fecha y hora"
        style={{
          position: "fixed",
          left: position.left,
          width: position.width,
          top: position.top,
          bottom: position.bottom,
          zIndex: PANEL_Z,
        }}
      >
        <div className="crm-datetime-popover-body">
          <div className="crm-datetime-popover-calendar">
            <Calendar
              className="crm-calendar crm-datetime-calendar"
              locale="es-CO"
              value={date}
              onChange={(v) => {
                const d = Array.isArray(v) ? v[0] : v;
                if (d) pickDate(d);
              }}
              minDetail="month"
              next2Label={null}
              prev2Label={null}
              formatMonthYear={(_locale, d) =>
                d.toLocaleDateString("es-CO", { month: "long", year: "numeric" })
              }
            />
          </div>
          <div className="crm-datetime-time-col">
            <p className="crm-datetime-time-label">Hora</p>
            <div className="crm-datetime-time-fields">
              <select
                id={`${id}-hour`}
                className="crm-datetime-time-select"
                value={hour}
                disabled={disabled}
                aria-label="Hora"
                onChange={(e) => pickHour(Number(e.target.value))}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {pad2(h)}
                  </option>
                ))}
              </select>
              <span className="crm-datetime-time-sep" aria-hidden>
                :
              </span>
              <select
                id={`${id}-minute`}
                className="crm-datetime-time-select"
                value={minute}
                disabled={disabled}
                aria-label="Minutos"
                onChange={(e) => pickMinute(Number(e.target.value))}
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {pad2(m)}
                  </option>
                ))}
              </select>
            </div>
            <p className="crm-datetime-time-hint">24 h</p>
          </div>
        </div>
        <div className="crm-datetime-popover-footer">
          <button
            type="button"
            className="crm-datetime-action-btn"
            onClick={setToday}
            disabled={disabled}
          >
            Hoy
          </button>
          <button
            type="button"
            className="crm-datetime-action-btn"
            onClick={clear}
            disabled={disabled}
          >
            Limpiar
          </button>
          <button
            type="button"
            className="crm-datetime-done-btn"
            onClick={() => setOpen(false)}
          >
            Listo
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className={`crm-datetime-wrap ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        className={`crm-datetime-trigger ${open ? "is-open" : ""}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className={`min-w-0 flex-1 truncate text-left ${
            value ? "text-[var(--crm-foreground)]" : "text-[var(--crm-muted)]"
          }`}
        >
          {value ? formatDateTimeShortEs(value) : placeholder}
        </span>
        <CalendarDays className="size-4 shrink-0 text-[var(--crm-muted)]" />
      </button>

      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </div>
  );
};

export default CrmDateTimePicker;
