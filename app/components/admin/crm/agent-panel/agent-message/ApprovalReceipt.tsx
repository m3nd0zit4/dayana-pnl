import { Check, CircleSlash, Clock } from "lucide-react";
import { approvalStatus, type ToolPartLike } from "@/lib/agent-ui/approval";
import { stepDoneLabel } from "@/lib/agent-ui/steps";
import { cn } from "@/lib/utils";

/**
 * The approval's trace in the conversation: one line. The card with the
 * buttons lives docked above the composer (ApprovalCard), never here too —
 * showing it in both places is what read as «asks twice».
 */
export const ApprovalReceipt = ({ part, isLive }: { part: ToolPartLike; isLive: boolean }) => {
  const status = approvalStatus(part, isLive);
  const label = stepDoneLabel(part.toolName);
  const { icon: Icon, text, className } =
    status === "pending"
      ? { icon: Clock, text: `Esperando tu aprobación · ${label}`, className: "text-warning" }
      : status === "approved"
        ? { icon: Check, text: `Aprobado · ${label}`, className: "text-success" }
        : status === "denied"
          ? { icon: CircleSlash, text: `Cancelado · ${label}`, className: "text-muted-foreground" }
          : { icon: CircleSlash, text: `Sin respuesta · ${label}`, className: "text-muted-foreground" };

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="agent-approval-receipt" data-status={status}>
      <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden />
      <span className="min-w-0 truncate">{text}</span>
    </p>
  );
};
