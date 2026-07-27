"use client";

import { Skeleton } from "@/app/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Props = {
  rows?: number;
  className?: string;
};

/** Placeholder de la lista mientras llega la primera página del feed. */
const NotificationBellSkeleton = ({ rows = 4, className }: Props) => (
  <div className={cn("divide-y divide-border", className)} aria-hidden>
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="flex gap-3 px-3 py-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
    ))}
  </div>
);

export default NotificationBellSkeleton;
