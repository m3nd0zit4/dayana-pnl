"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { capList, type EntityRef } from "@/lib/agent-ui/refs";
import { refTypeIcon } from "../ref-icons";

const MAX_VISIBLE = 6;

/** Links to the records the tools touched: deduplicated upstream, first six visible, the rest behind «+N». */
export const RefChips = ({ refs }: { refs: EntityRef[] }) => {
  const [showAll, setShowAll] = useState(false);
  if (refs.length === 0) return null;
  const { shown, hidden } = showAll ? { shown: refs, hidden: 0 } : capList(refs, MAX_VISIBLE);

  return (
    <div className="flex flex-wrap gap-1.5 pt-1" data-testid="agent-ref-chips">
      {shown.map((ref) => {
        const Icon = refTypeIcon(ref.type);
        return (
          <Link
            key={ref.href}
            href={ref.href}
            target="_blank"
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{ref.label ?? ref.type}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          aria-label={`Ver ${hidden} enlaces más`}
          className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          +{hidden}
        </button>
      )}
    </div>
  );
};
