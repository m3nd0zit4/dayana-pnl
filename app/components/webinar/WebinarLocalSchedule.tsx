"use client";

import LocalScheduleChips from "@/app/components/datetime/LocalScheduleChips";

type Props = {
  startsAtIso: string;
  hasTime?: boolean;
  userCountry?: string | null;
};

/** Webinar-branded wrapper around the shared visitor schedule chips. */
const WebinarLocalSchedule = ({
  startsAtIso,
  hasTime = true,
  userCountry,
}: Props) => (
  <LocalScheduleChips
    startsAtIso={startsAtIso}
    hasTime={hasTime}
    userCountry={userCountry}
  />
);

export default WebinarLocalSchedule;
