"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock } from "lucide-react";
import {
  buildVisitorScheduleLabels,
  resolveLabelsForVisitor,
} from "@/app/components/datetime/resolve-visitor-labels";
import { resolveVisitorDisplayTimeZone } from "@/lib/datetime/visitor-schedule";

type Props = {
  startsAtIso: string;
  /** When false, only the calendar date is shown (time still TBD). */
  hasTime?: boolean;
  /** ISO country from Vercel geo (helps pick display TZ + label). */
  userCountry?: string | null;
  /** Optional class override for chips. */
  chipClassName?: string;
  showIcons?: boolean;
};

type Labels = { date: string; time: string; place: string };

const defaultChipClass =
  "inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md";

/**
 * Formats an UTC instant in the visitor's display timezone with an explicit
 * place label ("hora Colombia", "hora Este · EE. UU.").
 */
const LocalScheduleChips = ({
  startsAtIso,
  hasTime = true,
  userCountry,
  chipClassName = defaultChipClass,
  showIcons = true,
}: Props) => {
  const [labels, setLabels] = useState<Labels | null>(() => {
    if (!userCountry?.trim()) return null;
    const timeZone = resolveVisitorDisplayTimeZone(userCountry);
    const built = buildVisitorScheduleLabels(
      startsAtIso,
      timeZone,
      userCountry
    );
    return { date: built.date, time: built.time, place: built.place };
  });

  useEffect(() => {
    const d = new Date(startsAtIso);
    if (Number.isNaN(d.getTime())) return;

    const ac = new AbortController();
    void resolveLabelsForVisitor(startsAtIso, userCountry, ac.signal).then(
      (built) => {
        setLabels({
          date: built.date,
          time: built.time,
          place: built.place,
        });
      }
    );
    return () => ac.abort();
  }, [startsAtIso, userCountry]);

  if (!labels) {
    return (
      <>
        <span className={`${chipClassName} text-black/40`}>
          {showIcons ? <Calendar className="h-4 w-4 text-terracotta" /> : null}
          …
        </span>
        {hasTime ? (
          <span className={`${chipClassName} text-black/40`}>
            {showIcons ? <Clock className="h-4 w-4 text-terracotta" /> : null}
            …
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <span className={`${chipClassName} capitalize`}>
        {showIcons ? (
          <Calendar className="h-4 w-4 shrink-0 text-terracotta" />
        ) : null}
        {labels.date}
      </span>
      {hasTime ? (
        <span className={chipClassName}>
          {showIcons ? (
            <Clock className="h-4 w-4 shrink-0 text-terracotta" />
          ) : null}
          <span>
            {labels.time}
            <span className="text-black/45"> · {labels.place}</span>
          </span>
        </span>
      ) : null}
    </>
  );
};

export default LocalScheduleChips;
