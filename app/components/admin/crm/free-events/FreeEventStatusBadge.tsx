import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";

const LABEL: Record<Status, string> = {
  DRAFT: "Borrador",
  OPEN: "Publicado",
  CLOSED: "Inscripciones cerradas",
  COMPLETED: "Realizado",
};

const TONE: Record<Status, string> = {
  DRAFT: "border-border bg-muted text-muted-foreground",
  OPEN: "border-success/40 bg-success/10 text-success",
  CLOSED: "border-warning/40 bg-warning/10 text-warning",
  COMPLETED: "border-border bg-transparent text-muted-foreground",
};

/** El estado de un evento, con el mismo color en la lista y en el detalle. */
const FreeEventStatusBadge = ({ status, className }: { status: Status; className?: string }) => (
  <Badge variant="outline" className={cn("shrink-0", TONE[status], className)}>
    {LABEL[status]}
  </Badge>
);

export default FreeEventStatusBadge;
