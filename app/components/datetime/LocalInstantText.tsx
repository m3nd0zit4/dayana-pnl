"use client";

import { useEffect, useState } from "react";
import { resolveLabelsForVisitor } from "@/app/components/datetime/resolve-visitor-labels";

type Mode = "time" | "date" | "datetime" | "timeWithPlace" | "datetimeWithPlace";

type Props = {
  startsAtIso: string;
  mode?: Mode;
  userCountry?: string | null;
  className?: string;
  /** Placeholder while hydrating (avoids SSR mismatch). */
  placeholder?: string;
};

/**
 * Single-line visitor-local instant. Use chips (`LocalScheduleChips`) when
 * you want calendar + clock pills.
 */
const LocalInstantText = ({
  startsAtIso,
  mode = "timeWithPlace",
  userCountry,
  className,
  placeholder = "…",
}: Props) => {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const d = new Date(startsAtIso);
    if (Number.isNaN(d.getTime())) return;

    const ac = new AbortController();
    void resolveLabelsForVisitor(startsAtIso, userCountry, ac.signal).then(
      (built) => {
        switch (mode) {
          case "time":
            setText(built.time);
            break;
          case "date":
            setText(built.date);
            break;
          case "datetime":
            setText(built.dateTime);
            break;
          case "datetimeWithPlace":
            setText(`${built.dateTime} · ${built.place}`);
            break;
          case "timeWithPlace":
          default:
            setText(`${built.time} · ${built.place}`);
            break;
        }
      }
    );
    return () => ac.abort();
  }, [startsAtIso, userCountry, mode]);

  return <span className={className}>{text ?? placeholder}</span>;
};

export default LocalInstantText;
