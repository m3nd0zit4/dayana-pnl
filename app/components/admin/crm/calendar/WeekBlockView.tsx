"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type EventProps,
  type View,
} from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import type { CalendarSessionEvent } from "@/lib/crm/calendar-sessions";

const locales = { es };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const OPERATIONAL_TZ = "America/Bogota";

/** Debe coincidir con --crm-cal-slot-height en crm.css */
const SLOT_HEIGHT_PX = 64;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;

type CalEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: CalendarSessionEvent;
};

type Props = {
  events: CalendarSessionEvent[];
  date: Date;
  view: View;
  onNavigate: (date: Date) => void;
  onViewChange: (view: View) => void;
  onSelectEvent?: (event: CalendarSessionEvent) => void;
};

const formatTime = (d: Date) =>
  d.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: OPERATIONAL_TZ,
  });

const SessionEventBlock = ({ event }: EventProps<CalEvent>) => {
  const r = event.resource;
  return (
    <div className="crm-cal-event-inner">
      <span className="crm-cal-event-name">{r.contact.firstName}</span>
      <span className="crm-cal-event-meta">
        S{r.sessionNumber} · {formatTime(event.start)} · {r.durationMinutes}m
      </span>
    </div>
  );
};

const WeekBlockView = ({
  events,
  date,
  view,
  onNavigate,
  onViewChange,
  onSelectEvent,
}: Props) => {
  const calEvents: CalEvent[] = useMemo(
    () =>
      events.map((ev) => {
        const start = new Date(ev.scheduledAt);
        const end = new Date(start.getTime() + ev.durationMinutes * 60_000);
        return {
          id: ev.id,
          title: `${ev.contact.firstName} · S${ev.sessionNumber}`,
          start,
          end,
          resource: ev,
        };
      }),
    [events]
  );

  const wrapRef = useRef<HTMLDivElement>(null);

  const scrollToTime = useMemo(() => {
    const now = new Date();
    const hour = Math.min(
      DAY_END_HOUR - 3,
      Math.max(DAY_START_HOUR, now.getHours() - 1)
    );
    return new Date(1970, 0, 1, hour, 0, 0);
  }, []);

  useEffect(() => {
    const scroller = wrapRef.current?.querySelector<HTMLElement>(
      ".rbc-time-content"
    );
    if (!scroller) return;

    const hourOffset = Math.max(0, scrollToTime.getHours() - DAY_START_HOUR);
    scroller.scrollTop = hourOffset * SLOT_HEIGHT_PX;
  }, [scrollToTime, date, view, events.length]);

  return (
    <div
      ref={wrapRef}
      className="crm-surface-card crm-big-calendar-wrap"
      style={{ "--crm-cal-slot-height": `${SLOT_HEIGHT_PX}px` } as React.CSSProperties}
    >
      <div className="crm-big-calendar-body">
        <Calendar
          localizer={localizer}
          events={calEvents}
          startAccessor="start"
          endAccessor="end"
          views={["week", "day"]}
          view={view}
          date={date}
          onNavigate={onNavigate}
          onView={onViewChange}
          culture="es"
          toolbar={false}
          step={60}
          timeslots={1}
          scrollToTime={scrollToTime}
          min={new Date(1970, 0, 1, DAY_START_HOUR, 0, 0)}
          max={new Date(1970, 0, 1, DAY_END_HOUR, 0, 0)}
          longPressThreshold={0}
          dayLayoutAlgorithm="no-overlap"
          tooltipAccessor={(ev: CalEvent) => {
            const r = ev.resource;
            return `${r.contact.firstName} ${r.contact.lastName ?? ""} · Sesión ${r.sessionNumber}\n${formatTime(ev.start)} · ${r.durationMinutes} min\nTZ contacto: ${r.contact.timezone}`;
          }}
          onSelectEvent={(ev: CalEvent) => onSelectEvent?.(ev.resource)}
          components={{ event: SessionEventBlock }}
          formats={{
            dayFormat: (d) => format(d, "EEE d", { locale: es }),
            weekdayFormat: (d) => format(d, "EEE", { locale: es }),
            timeGutterFormat: (d) => format(d, "HH:mm", { locale: es }),
          }}
          eventPropGetter={() => ({
            className: "crm-cal-event",
          })}
        />
      </div>
      <p className="crm-big-calendar-footer">
        {OPERATIONAL_TZ} · 7:00–22:00 · desplázate verticalmente para ver la tarde
      </p>
    </div>
  );
};

export default WeekBlockView;
