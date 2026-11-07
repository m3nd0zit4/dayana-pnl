import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/app/components/ui/button";

/** A turn that failed says so in the conversation, with the reason when known, and offers to try again. */
export const ErrorBubble = ({
  reason,
  onRetry,
  retrying,
}: {
  reason: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) => (
  <div
    role="alert"
    data-testid="agent-error"
    className="flex w-full flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
  >
    <p className="flex items-center gap-2 font-medium text-destructive">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      No pude terminar esto
    </p>
    {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    {onRetry && (
      <div>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} data-testid="agent-error-retry">
          <RotateCcw className="size-3.5" aria-hidden />
          Reintentar
        </Button>
      </div>
    )}
  </div>
);
