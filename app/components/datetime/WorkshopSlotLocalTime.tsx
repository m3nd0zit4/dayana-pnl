"use client";

import { useEffect, useState } from "react";
import { detectCountryFromVisitorIp } from "@/app/components/datetime/resolve-visitor-labels";
import {
  formatLocalClockTime,
  resolveVisitorDisplayTimeZone,
} from "@/lib/datetime/visitor-schedule";
import {
  getDateKeyInTz,
  zonedDateTimeToUtc,
} from "@/lib/datetime/zoned-time";
import { getScheduleSlotLabel } from "@/lib/workshop-schedule";
import type { WorkshopScheduleSlot } from "@/lib/workshops";

type Props = {
  slot: WorkshopScheduleSlot;
  /** Workshop start instant — anchors slot HH:mm to a calendar day. */
  startsAtIso?: string | null;
  scheduleTimezone?: string;
  userCountry?: string | null;
  className?: string;
};

/**
 * Converts a day-schedule HH:mm range (entered in CRM TZ) to the visitor's
 * local clock when `startsAtIso` is known; otherwise falls back to the
 * static label.
 */
const WorkshopSlotLocalTime = ({
  slot,
  startsAtIso,
  scheduleTimezone = "America/Bogota",
  userCountry,
  className,
}: Props) => {
  const [label, setLabel] = useState(getScheduleSlotLabel(slot));

  useEffect(() => {
    if (
      !startsAtIso ||
      !slot.startTime.trim() ||
      !slot.endTime.trim() ||
      Number.isNaN(new Date(startsAtIso).getTime())
    ) {
      setLabel(getScheduleSlotLabel(slot));
      return;
    }

    const ac = new AbortController();
    void (async () => {
      try {
        let country = userCountry ?? null;
        if (!country?.trim()) {
          const detected = await detectCountryFromVisitorIp(ac.signal);
          country = detected?.country ?? null;
        }
        const dateKey = getDateKeyInTz(new Date(startsAtIso), scheduleTimezone);
        const startUtc = zonedDateTimeToUtc(
          dateKey,
          slot.startTime,
          scheduleTimezone
        );
        const endUtc = zonedDateTimeToUtc(
          dateKey,
          slot.endTime,
          scheduleTimezone
        );
        const visitorTz = resolveVisitorDisplayTimeZone(country);
        const start = formatLocalClockTime(startUtc.toISOString(), visitorTz);
        const end = formatLocalClockTime(endUtc.toISOString(), visitorTz);
        setLabel(`${start} – ${end}`);
      } catch {
        setLabel(getScheduleSlotLabel(slot));
      }
    })();

    return () => ac.abort();
  }, [slot, startsAtIso, scheduleTimezone, userCountry]);

  return <span className={className}>{label}</span>;
};

export default WorkshopSlotLocalTime;
