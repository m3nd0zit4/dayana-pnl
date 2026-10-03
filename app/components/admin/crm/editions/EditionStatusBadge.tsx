import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/lib/utils";
import { EDITION_STATUS_LABEL, EDITION_STATUS_SHORT, type EditionStatus } from "./status";

const TONE: Record<EditionStatus, string> = {
  DRAFT: "border-border bg-muted text-muted-foreground",
  OPEN: "border-success/40 bg-success/10 text-success",
  CLOSED: "border-warning/40 bg-warning/10 text-warning",
  COMPLETED: "border-border bg-transparent text-muted-foreground",
};

/**
 * El estado de una edición, con el mismo color en la lista y en el detalle,
 * en eventos y en talleres. En el teléfono, la palabra corta.
 */
const EditionStatusBadge = ({
  status,
  labels = EDITION_STATUS_LABEL,
  className,
}: {
  status: EditionStatus;
  labels?: Record<EditionStatus, string>;
  className?: string;
}) => (
  <Badge variant="outline" className={cn("shrink-0", TONE[status], className)} title={labels[status]}>
    <span className="sm:hidden">{EDITION_STATUS_SHORT[status]}</span>
    <span className="hidden sm:inline">{labels[status]}</span>
  </Badge>
);

export default EditionStatusBadge;
