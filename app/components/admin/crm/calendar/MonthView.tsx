"use client";

import { CalendarDays, Clock } from "lucide-react";
import { useMemo, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import type { CalendarSessionEvent } from "@/lib/crm/calendar-sessions";

type ValuePiece = Date | null;
type Value = ValuePiece | [ValuePiece, ValuePiece];

type Props = {
  events: CalendarSessionEvent[];
  activeDate: Date;
  onDateChange: (date: Date) => void;
  onEventClick?: (event: CalendarSessionEvent) => void;
};

const OPERATIONAL_TZ = "America/Bogota";

const dayKey = (d: Date) =>
  d.toLocaleDateString("en-CA", { timeZone: OPERATIONAL_TZ });

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: OPERATIONAL_TZ,
  });

const MonthView = ({ events, activeDate, onDateChange, onEventClick }: Props) => {
  const [value, setValue] = useState<Value>(activeDate);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarSessionEvent[]>();
    for (const ev of events) {
      const key = dayKey(new Date(ev.scheduledAt));
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      );
    }
    return map;
  }, [events]);

  const selectedDayEvents = eventsByDay.get(dayKey(activeDate)) ?? [];
  const monthSessionCount = events.length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
      <div className="crm-surface-card crm-month-calendar-card p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="crm-font-display text-[10px] text-[var(--crm-muted)]">
            Vista mensual
          </p>
          {monthSessionCount > 0 && (
            <span className="rounded-full bg-[var(--crm-accent-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--crm-accent)]">
              {monthSessionCount} sesión{monthSessionCount === 1 ? "" : "es"} este mes
            </span>
          )}
        </div>
        <Calendar
          className="crm-calendar"
          locale="es-CO"
          value={value}
          onChange={(v) => {
            setValue(v);
            const d = Array.isArray(v) ? v[0] : v;
            if (d) onDateChange(d);
          }}
          tileClassName={({ date }) => {
            const count = eventsByDay.get(dayKey(date))?.length ?? 0;
            return count > 0 ? "crm-calendar-has-events" : undefined;
          }}
          tileContent={({ date }) => {
            const count = eventsByDay.get(dayKey(date))?.length ?? 0;
            if (count === 0) return null;
            return (
              <span className="crm-calendar-dot" aria-label={`${count} sesiones`}>
                {count > 1 ? count : ""}
              </span>
            );
          }}
        />
      </div>

      <div className="crm-surface-card flex min-h-[320px] flex-col p-5 md:min-h-[380px]">
        <div className="border-b border-[var(--crm-border)] pb-4">
          <h3 className="crm-section-title text-sm capitalize">
            {activeDate.toLocaleDateString("es-CO", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: OPERATIONAL_TZ,
            })}
          </h3>
          <p className="crm-section-subtitle mt-1">
            {selectedDayEvents.length === 0
              ? "Sin sesiones agendadas"
              : `${selectedDayEvents.length} sesión${selectedDayEvents.length === 1 ? "" : "es"}`}
          </p>
        </div>

        {selectedDayEvents.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
            <CalendarDays
              className="size-8 text-[var(--crm-muted)]/50"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="text-sm text-[var(--crm-muted)]">
              Nada agendado este día
            </p>
            <p className="max-w-[220px] text-[11px] text-[var(--crm-muted)]/80">
              Usa la agenda semanal o «Sesiones pendientes» para programar.
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1">
            {selectedDayEvents.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  className="crm-day-session-card group w-full text-left"
                  onClick={() => onEventClick?.(ev)}
                >
                  <div className="flex items-start gap-3">
                    <span className="crm-day-session-time">
                      {formatTime(ev.scheduledAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold leading-tight">
                          {ev.contact.firstName} {ev.contact.lastName ?? ""}
                        </span>
                        <span className="shrink-0 rounded-md bg-[var(--crm-linen)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--crm-muted)]">
                          S{ev.sessionNumber}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--crm-muted)]">
                        {ev.productTitle} · {ev.durationMinutes} min
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--crm-muted)]">
                        <Clock className="size-3 shrink-0" aria-hidden />
                        TZ contacto: {ev.contact.timezone}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MonthView;
