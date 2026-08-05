"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock } from "lucide-react";
import {
  formatLocalClockTime,
  formatLocalLongDate,
  getSchedulePlaceLabel,
  getVisitorTimeZone,
} from "@/lib/webinar/schedule-place-label";

type Props = {
  startsAtIso: string;
  /** When false, only the calendar date is shown (time still TBD). */
  hasTime?: boolean;
  /** ISO country from Vercel geo (helps disambiguate US/CA/MX zones). */
  userCountry?: string | null;
};

type Labels = { date: string; time: string; place: string };

const chipClass =
  "inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md";

/**
 * Formats the webinar instant in the visitor's timezone, with an explicit
 * place label ("hora Colombia", "hora Este · EE. UU.") so GMT offsets never
 * leave the time ambiguous. If `hasTime` is false, only the date chip renders.
 */
const WebinarLocalSchedule = ({
  startsAtIso,
  hasTime = true,
  userCountry,
}: Props) => {
  const [labels, setLabels] = useState<Labels | null>(null);

  useEffect(() => {
    const d = new Date(startsAtIso);
    if (Number.isNaN(d.getTime())) return;

    const timeZone = getVisitorTimeZone();
    setLabels({
      date: formatLocalLongDate(startsAtIso, timeZone),
      time: formatLocalClockTime(startsAtIso, timeZone),
      place: getSchedulePlaceLabel(timeZone, userCountry),
    });
  }, [startsAtIso, userCountry]);

  if (!labels) {
    return (
      <>
        <span className={`${chipClass} text-black/40`}>
          <Calendar className="h-4 w-4 text-terracotta" />
          …
        </span>
        {hasTime ? (
          <span className={`${chipClass} text-black/40`}>
            <Clock className="h-4 w-4 text-terracotta" />
            …
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <span className={`${chipClass} capitalize`}>
        <Calendar className="h-4 w-4 shrink-0 text-terracotta" />
        {labels.date}
      </span>
      {hasTime ? (
        <span className={chipClass}>
          <Clock className="h-4 w-4 shrink-0 text-terracotta" />
          <span>
            {labels.time}
            <span className="text-black/45"> · {labels.place}</span>
          </span>
        </span>
      ) : null}
    </>
  );
};

export default WebinarLocalSchedule;
