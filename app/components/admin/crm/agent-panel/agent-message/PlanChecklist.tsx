import { Check, Circle, CircleDot, CircleSlash } from "lucide-react";
import type { PlanItem } from "@/lib/agent-ui/steps";
import { cn } from "@/lib/utils";

const ICONS: Record<PlanItem["status"], { icon: typeof Check; className: string; label: string }> = {
  pending: { icon: Circle, className: "text-muted-foreground", label: "Pendiente" },
  in_progress: { icon: CircleDot, className: "text-foreground", label: "En curso" },
  completed: { icon: Check, className: "text-success", label: "Hecho" },
  cancelled: { icon: CircleSlash, className: "text-muted-foreground", label: "Descartado" },
};

/** The router's `todo` list as a compact plan, instead of a raw tool card. */
export const PlanChecklist = ({ items }: { items: PlanItem[] }) => {
  const done = items.filter((i) => i.status === "completed").length;
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2" data-testid="agent-plan">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Plan · {done} de {items.length}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => {
          const { icon: Icon, className, label } = ICONS[item.status];
          return (
            <li key={`${index}-${item.content}`} className="flex items-start gap-2 text-xs">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} aria-label={label} />
              <span
                className={cn(
                  "min-w-0 flex-1",
                  item.status === "completed" && "text-muted-foreground line-through",
                  item.status === "cancelled" && "text-muted-foreground line-through",
                  item.status === "in_progress" && "font-medium text-foreground"
                )}
              >
                {item.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
