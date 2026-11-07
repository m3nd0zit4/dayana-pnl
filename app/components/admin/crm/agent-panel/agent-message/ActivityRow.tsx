"use client";

import { Check, ChevronDown, CircleAlert, CircleSlash, Clock, Loader2 } from "lucide-react";
import { activitySummary, formatDuration, specialistReport, type Activity, type ActivityStep, type StepStatus } from "@/lib/agent-ui/steps";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CodeBlock } from "../ai-elements/code-block";
import { MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";

const STATUS_ICON: Record<StepStatus, { icon: typeof Check; className: string; label: string }> = {
  running: { icon: Loader2, className: "animate-spin text-muted-foreground", label: "En curso" },
  waiting: { icon: Clock, className: "text-warning", label: "Esperando tu aprobación" },
  done: { icon: Check, className: "text-success", label: "Listo" },
  error: { icon: CircleAlert, className: "text-destructive", label: "Falló" },
  denied: { icon: CircleSlash, className: "text-muted-foreground", label: "No se hizo" },
};

const json = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/** Raw input/output, one click away and never inline. */
const StepDetails = ({ step }: { step: ActivityStep }) => {
  const { part } = step;
  const input = part.input;
  const hasInput = input !== undefined && !(typeof input === "object" && input !== null && Object.keys(input).length === 0);
  const hasOutput = part.output !== undefined;
  if (!hasInput && !hasOutput && !part.errorText) return null;

  return (
    <Collapsible className="group/details">
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronDown className="size-3 transition-transform group-data-open/details:rotate-180" />
        Ver detalles
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-2">
        {hasInput && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Datos que usó</p>
            <div className="rounded-md bg-muted/50">
              <CodeBlock code={json(input)} />
            </div>
          </div>
        )}
        {part.errorText ? (
          <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{part.errorText}</p>
        ) : (
          hasOutput && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Resultado</p>
              <div className="rounded-md bg-muted/50">
                <CodeBlock code={typeof part.output === "string" ? part.output : json(part.output)} />
              </div>
            </div>
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

const StepRow = ({ step }: { step: ActivityStep }) => {
  const status = STATUS_ICON[step.status];
  const Icon = status.icon;
  const report = step.kind === "specialist" && step.status === "done" ? specialistReport(step.part.output) : null;

  return (
    <li className="flex gap-2" data-testid="agent-activity-step" data-status={step.status}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", status.className)} aria-label={status.label} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs text-foreground">
          {step.status === "running" ? `${step.runningLabel}…` : step.label}
        </p>
        {report && (
          <Collapsible className="group/report">
            <CollapsibleTrigger className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronDown className="size-3 transition-transform group-data-open/report:rotate-180" />
              Ver su informe
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
              <MessageResponse>{report}</MessageResponse>
            </CollapsibleContent>
          </Collapsible>
        )}
        <StepDetails step={step} />
      </div>
    </li>
  );
};

export type ReasoningSummary = { text: string; streaming: boolean; ms?: number };

const ReasoningRow = ({ reasoning }: { reasoning: ReasoningSummary }) => (
  <li className="flex gap-2" data-testid="agent-activity-reasoning">
    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
    <Collapsible className="group/thought min-w-0 flex-1">
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-xs text-foreground outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        {reasoning.streaming ? "Pensando…" : reasoning.ms ? `Pensó ${formatDuration(reasoning.ms)}` : "Pensó unos segundos"}
        <ChevronDown className="size-3 transition-transform group-data-open/thought:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 text-xs text-muted-foreground">
        <MessageResponse>{reasoning.text}</MessageResponse>
      </CollapsibleContent>
    </Collapsible>
  </li>
);

/**
 * One line per assistant message for everything it did on the way to the
 * answer. While it works: the current step in a shimmer («Buscando
 * contactos…»). After: «N pasos · Xs», which opens the list — each step's
 * raw data only behind its own «Ver detalles».
 */
export const ActivityRow = ({
  activity,
  reasoning,
  durationMs,
  thinkingNow,
}: {
  activity: Activity;
  reasoning: ReasoningSummary | null;
  durationMs?: number;
  /** The model is reasoning right now with no tool running. */
  thinkingNow: boolean;
}) => {
  const running = activity.running || thinkingNow;
  const label = activity.currentLabel ?? (thinkingNow ? "Pensando…" : "Trabajando…");
  const { steps, errorCount } = activity;
  const summary =
    errorCount > 0
      ? `${activitySummary(steps.length, durationMs)} · ${errorCount === 1 ? "1 falló" : `${errorCount} fallaron`}`
      : activitySummary(steps.length, durationMs);
  const DoneIcon = errorCount > 0 ? CircleAlert : Check;

  return (
    <Collapsible className="group/activity w-full" data-testid="agent-activity" data-state={running ? "running" : "done"}>
      <CollapsibleTrigger className="flex max-w-full items-center gap-2 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        {running ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            <Shimmer className="truncate">{label}</Shimmer>
          </>
        ) : (
          <>
            <DoneIcon className={cn("size-3.5 shrink-0", errorCount > 0 ? "text-destructive" : "text-muted-foreground")} aria-hidden />
            <span className="truncate">{summary}</span>
          </>
        )}
        <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-open/activity:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <ol className="flex flex-col gap-2 border-l border-border pl-3">
          {reasoning && <ReasoningRow reasoning={reasoning} />}
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
};
