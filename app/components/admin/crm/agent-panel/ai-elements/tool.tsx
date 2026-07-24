"use client";

import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

/**
 * Ported from Vercel AI Elements (see conversation.tsx header comment).
 * Adapted for Base UI's `data-open`/`data-closed` collapsible convention
 * (this project's, not Radix's `data-state`) and the local `CodeBlock` stub
 * (no shiki). `ToolPart`'s state union matches eve's `EveDynamicToolPart`
 * state machine 1:1 — `input-streaming|input-available|approval-requested|
 * approval-responded|output-available|output-error|output-denied`.
 */
export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("group not-prose mb-4 w-full rounded-md border", className)} {...props} />
);

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export type ToolHeaderProps = {
  title?: string;
  toolName: string;
  state: ToolState;
  className?: string;
};

const statusLabels: Record<ToolState, string> = {
  "approval-requested": "Esperando confirmación",
  "approval-responded": "Respondido",
  "input-available": "Ejecutando",
  "input-streaming": "Pendiente",
  "output-available": "Completado",
  "output-denied": "Cancelado",
  "output-error": "Error",
};

const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

const getStatusBadge = (status: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({ className, title, toolName, state, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger className={cn("flex w-full items-center justify-between gap-4 p-3", className)} {...props}>
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">{title ?? toolName}</span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-open:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-closed:fade-out-0 data-closed:slide-out-to-top-2 data-open:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-closed:animate-out data-open:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parámetros</h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText: string | undefined;
};

export const ToolOutput = ({ className, output, errorText, children, ...props }: ToolOutputProps & { children?: ReactNode }) => {
  if (!output && !errorText) return null;

  let Output: ReactNode = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && output !== null && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Resultado"}
      </h4>
      <div
        className={cn(
          "overflow-x-hidden rounded-md text-xs [&_table]:w-full",
          errorText ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {!errorText && Output}
      </div>
      {children}
    </div>
  );
};
