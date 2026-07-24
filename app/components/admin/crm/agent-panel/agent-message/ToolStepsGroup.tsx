import type { EveDynamicToolPart } from "eve/react";
import { CheckCircle2, ChevronDown, CircleAlert, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../ai-elements/tool";
import { TOOL_LABELS } from "./tool-labels";

const TERMINAL_STATES = new Set<EveDynamicToolPart["state"]>(["output-available", "output-error", "output-denied"]);
const ERROR_STATES = new Set<EveDynamicToolPart["state"]>(["output-error", "output-denied"]);

/**
 * Collapsed-by-default "N pasos completados" line for a run of tool calls —
 * chat-native (no card chrome) at the summary level, matching how the rest
 * of the conversation reads. Expanding it reveals one row per step, each its
 * own nested `Tool` collapsible — raw parameter/result JSON sits two levels
 * deep now instead of one, still there for debugging, no longer the default view.
 */
export const ToolStepsGroup = ({ parts }: { parts: EveDynamicToolPart[] }) => {
  const total = parts.length;
  const doneCount = parts.filter((p) => TERMINAL_STATES.has(p.state)).length;
  const errorCount = parts.filter((p) => ERROR_STATES.has(p.state)).length;
  const allDone = doneCount === total;
  const firstPendingIndex = parts.findIndex((p) => !TERMINAL_STATES.has(p.state));

  const summary = !allDone
    ? `Ejecutando paso ${firstPendingIndex + 1} de ${total}…`
    : total === 1
      ? errorCount > 0
        ? "1 paso completado con error"
        : "1 paso completado"
      : errorCount > 0
        ? `${total} pasos completados (${errorCount} con error)`
        : `${total} pasos completados`;

  const Icon = !allDone ? Loader2 : errorCount > 0 ? CircleAlert : CheckCircle2;

  return (
    <Collapsible className="group w-full">
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <Icon
          className={cn(
            "size-4 shrink-0",
            !allDone && "animate-spin",
            allDone && errorCount > 0 && "text-destructive",
            allDone && errorCount === 0 && "text-green-600"
          )}
        />
        <span>{summary}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-1 border-l border-border pl-3">
        {parts.map((part) => (
          <Tool key={part.toolCallId} className="mb-0">
            <ToolHeader state={part.state} title={TOOL_LABELS[part.toolName] ?? part.toolName} toolName={part.toolName} />
            <ToolContent>
              <ToolInput input={"input" in part ? part.input : undefined} />
              <ToolOutput
                output={"output" in part ? part.output : undefined}
                errorText={"errorText" in part ? part.errorText : undefined}
              />
            </ToolContent>
          </Tool>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ToolStepsGroup;
