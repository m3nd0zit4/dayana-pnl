"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { View } from "react-big-calendar";
import CrmPageShell from "./CrmPageShell";
import ScheduleSessionModal from "./ScheduleSessionModal";
import { useCrm } from "./CrmProvider";
import type { CalendarSessionEvent } from "@/lib/crm/calendar-sessions";

const MonthView = dynamic(() => import("./calendar/MonthView"), { ssr: false });
const WeekBlockView = dynamic(() => import("./calendar/WeekBlockView"), { ssr: false });

type CalendarView = "month" | "week";

type PendingSlot = {
  sessionId: string;
  sessionNumber: number;
  therapyPackageId: string;
  enrollmentId: string;
  meetDefaultUrl: string | null;
  contactName: string;
  contactId: string;
  contactTimezone: string;
  productTitle: string;
};

const OPERATIONAL_TZ = "America/Bogota";

const startOfWeekMonday = (d: Date) => {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const endOfWeekSunday = (d: Date) => {
  const start = startOfWeekMonday(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
};

const startOfMonthGrid = (d: Date) => {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  return start;
};

const endOfMonthGrid = (d: Date) => {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7)) % 7);
  end.setHours(23, 59, 59, 999);
  return end;
};

const formatWeekRange = (anchor: Date) => {
  const start = startOfWeekMonday(anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("es-CO", {
      day: "numeric",
      month: "short",
      timeZone: OPERATIONAL_TZ,
    });
  const year = anchor.toLocaleDateString("es-CO", {
    year: "numeric",
    timeZone: OPERATIONAL_TZ,
  });
  return `${fmt(start)} – ${fmt(end)} ${year}`;
};

const CalendarPageClient = () => {
  const { toast, canWrite } = useCrm();
  const [viewMode, setViewMode] = useState<CalendarView>("month");
  const [blockView, setBlockView] = useState<View>("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarSessionEvent[]>([]);
  const [pendingSlots, setPendingSlots] = useState<PendingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarSessionEvent | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSlot, setScheduleSlot] = useState<PendingSlot | null>(null);

  const range = useCallback(() => {
    if (viewMode === "month") {
      return { from: startOfMonthGrid(anchorDate), to: endOfMonthGrid(anchorDate) };
    }
    return { from: startOfWeekMonday(anchorDate), to: endOfWeekSunday(anchorDate) };
  }, [viewMode, anchorDate]);

  const periodLabel = useMemo(() => {
    if (viewMode === "month") {
      return anchorDate.toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
        timeZone: OPERATIONAL_TZ,
      });
    }
    return formatWeekRange(anchorDate);
  }, [viewMode, anchorDate]);

  const loadEvents = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const { from, to } = range();
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const res = await fetch(`/api/admin/calendar/sessions?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { sessions?: CalendarSessionEvent[] };
        setEvents(data.sessions ?? []);
      } else if (!opts?.silent) {
        toast("Error al cargar calendario", "error");
      }
      if (!opts?.silent) setLoading(false);
    },
    [range, toast]
  );

  const loadPending = useCallback(async () => {
    if (!canWrite) return;
    const res = await fetch("/api/admin/calendar/pending");
    if (res.ok) {
      const data = (await res.json()) as { slots?: PendingSlot[] };
      setPendingSlots(data.slots ?? []);
    }
  }, [canWrite]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const shiftDate = (delta: number) => {
    setAnchorDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") {
        next.setMonth(next.getMonth() + delta);
      } else if (blockView === "day") {
        next.setDate(next.getDate() + delta);
      } else {
        next.setDate(next.getDate() + delta * 7);
      }
      return next;
    });
  };

  return (
    <CrmPageShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="crm-section-title text-xl">Calendario de terapias</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              Sesiones en zona operativa {OPERATIONAL_TZ}. El mes es la vista
              principal; la agenda semanal sirve para bloques horarios.
            </p>
          </div>
          <div className="crm-view-toggle" role="tablist" aria-label="Vista del calendario">
            {(
              [
                { id: "month" as const, label: "Mes" },
                { id: "week" as const, label: "Agenda" },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={viewMode === v.id}
                className={`crm-view-toggle-btn ${viewMode === v.id ? "is-active" : ""}`}
                onClick={() => setViewMode(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="crm-btn-icon size-8"
              onClick={() => shiftDate(-1)}
              aria-label="Periodo anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[200px] px-1 text-center text-sm font-medium capitalize">
              {periodLabel}
            </span>
            <button
              type="button"
              className="crm-btn-icon size-8"
              onClick={() => shiftDate(1)}
              aria-label="Periodo siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <button
            type="button"
            className="crm-btn-ghost text-xs"
            onClick={() => setAnchorDate(new Date())}
          >
            Hoy
          </button>

          {viewMode === "week" && (
            <div className="crm-view-toggle ml-auto" role="tablist" aria-label="Escala agenda">
              {(
                [
                  { id: "week" as const, label: "Semana" },
                  { id: "day" as const, label: "Día" },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={blockView === v.id}
                  className={`crm-view-toggle-btn text-[11px] ${blockView === v.id ? "is-active" : ""}`}
                  onClick={() => setBlockView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="crm-surface-card p-8">
            <div className="crm-calendar-skeleton" aria-hidden />
            <p className="mt-4 text-center text-sm text-[var(--crm-muted)]">
              Cargando sesiones…
            </p>
          </div>
        ) : viewMode === "month" ? (
          <MonthView
            events={events}
            activeDate={anchorDate}
            onDateChange={setAnchorDate}
            onEventClick={setSelectedEvent}
          />
        ) : (
          <WeekBlockView
            events={events}
            date={anchorDate}
            view={blockView}
            onNavigate={setAnchorDate}
            onViewChange={setBlockView}
            onSelectEvent={setSelectedEvent}
          />
        )}

        {selectedEvent && (
          <div className="crm-surface-card crm-session-detail-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="crm-font-display text-[10px] text-[var(--crm-muted)]">
                  Sesión seleccionada
                </p>
                <h3 className="mt-1 text-base font-semibold">
                  {selectedEvent.contact.firstName}{" "}
                  {selectedEvent.contact.lastName ?? ""}
                </h3>
                <p className="mt-1 text-sm text-[var(--crm-muted)]">
                  Sesión {selectedEvent.sessionNumber} · {selectedEvent.productTitle}
                </p>
                <p className="mt-2 text-sm">
                  {new Date(selectedEvent.scheduledAt).toLocaleString("es-CO", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: OPERATIONAL_TZ,
                  })}{" "}
                  <span className="text-[var(--crm-muted)]">({OPERATIONAL_TZ})</span>
                </p>
                <p className="mt-1 text-xs text-[var(--crm-muted)]">
                  Zona contacto: {selectedEvent.contact.timezone}
                  {selectedEvent.meetUrl && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={selectedEvent.meetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--crm-accent)] hover:underline"
                      >
                        Enlace Meet
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <Link
                  href={`/admin/enrollments/${selectedEvent.enrollmentId}`}
                  className="crm-btn-secondary text-xs"
                >
                  Gestionar servicio
                </Link>
                <Link
                  href={`/admin/contacts/${selectedEvent.contact.id}?tab=notas`}
                  className="crm-btn-ghost text-xs"
                >
                  Notas
                </Link>
                <button
                  type="button"
                  className="crm-btn-icon size-8"
                  onClick={() => setSelectedEvent(null)}
                  aria-label="Cerrar detalle"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {canWrite && (
          <section className="crm-surface-card p-5">
            <h2 className="crm-section-title mb-1 text-sm">Sesiones pendientes de agendar</h2>
            <p className="mb-4 text-xs text-[var(--crm-muted)]">
              Slots sin fecha en terapias activas. También desde{" "}
              <Link href="/admin/therapies" className="text-[var(--crm-accent)] hover:underline">
                Terapias
              </Link>
              .
            </p>
            {pendingSlots.length === 0 ? (
              <p className="text-sm text-[var(--crm-muted)]">
                No hay sesiones pendientes de agendar.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--crm-border)]">
                {pendingSlots.slice(0, 12).map((slot) => (
                  <li
                    key={slot.sessionId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{slot.contactName}</p>
                      <p className="text-xs text-[var(--crm-muted)]">
                        Sesión {slot.sessionNumber} · {slot.productTitle}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="crm-btn-secondary shrink-0 text-xs"
                      onClick={() => {
                        setScheduleSlot(slot);
                        setScheduleOpen(true);
                      }}
                    >
                      Agendar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pendingSlots.length > 12 && (
              <p className="mt-3 text-xs text-[var(--crm-muted)]">
                +{pendingSlots.length - 12} más en{" "}
                <Link href="/admin/therapies" className="text-[var(--crm-accent)] hover:underline">
                  Terapias
                </Link>
              </p>
            )}
          </section>
        )}

        {scheduleSlot && (
          <ScheduleSessionModal
            open={scheduleOpen}
            onClose={() => {
              setScheduleOpen(false);
              setScheduleSlot(null);
            }}
            onScheduled={() => {
              void Promise.all([
                loadEvents({ silent: true }),
                loadPending(),
              ]);
            }}
            therapyPackageId={scheduleSlot.therapyPackageId}
            sessionNumber={scheduleSlot.sessionNumber}
            meetDefaultUrl={scheduleSlot.meetDefaultUrl}
            contactTimezone={scheduleSlot.contactTimezone}
            contactName={scheduleSlot.contactName}
            productTitle={scheduleSlot.productTitle}
          />
        )}
      </div>
    </CrmPageShell>
  );
};

export default CalendarPageClient;
