"use client";

import { useEffect, useMemo, useState } from "react";
import type { EveDynamicToolPart } from "eve/react";
import { ChevronDown, PencilLine, Send, ShieldAlert, X } from "lucide-react";
import { APPROVAL_OPTION_LABELS, isApprovalPart } from "@/lib/agent-ui/approval";
import { summarizeApproval } from "@/lib/agent-ui/approval-summary";
import { Button } from "@/app/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/utils";
import { CodeBlock } from "../ai-elements/code-block";
import { sanitizePromptText } from "./sanitize-text";

export type InputResponse = { optionId?: string; text?: string };
export type InputResponder = (requestId: string, response: InputResponse) => void;

type Props = {
  part: EveDynamicToolPart;
  canRespond: boolean;
  onRespond: InputResponder;
  /** id → label seen earlier in the thread, so the card can say who receives it. */
  names: Readonly<Record<string, string>>;
};

/**
 * The one approval card: what the tool is about to do, in words, with
 * «Cancelar» / «Aprobar». Execute-level tools (a message a real person gets,
 * money, a public price) get the warning tone and always name who receives
 * it. The conversation only shows a one-line receipt for it.
 */
/** Ids in the call the thread never named (a specialist looked them up, not this panel). */
const RECIPIENT_KEYS = ["contactId", "conversationId"] as const;

const useRecipientNames = (input: unknown, names: Readonly<Record<string, string>>) => {
  const missing = useMemo(() => {
    if (!input || typeof input !== "object") return [];
    const record = input as Record<string, unknown>;
    return RECIPIENT_KEYS.map((k) => record[k]).filter((v): v is string => typeof v === "string" && !names[v]);
  }, [input, names]);
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const key = missing.join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/admin/agent/names?ids=${encodeURIComponent(key)}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<{ names?: Record<string, string> }>) : null))
      .then((data) => {
        if (!cancelled && data?.names) setFetched((prev) => ({ ...prev, ...data.names }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return useMemo(() => ({ ...fetched, ...names }), [fetched, names]);
};

const ApprovalCard = ({ part, canRespond, onRespond, names }: Props) => {
  const request = part.toolMetadata?.eve?.inputRequest;
  const input = "input" in part ? part.input : undefined;
  const allNames = useRecipientNames(input, names);
  if (!request) return null;
  const summary = summarizeApproval(part.toolName, input, { names: allNames });
  const isExecute = summary.access === "execute";
  const Icon = isExecute ? ShieldAlert : PencilLine;

  return (
    <section
      data-testid="agent-approval-card"
      data-access={summary.access}
      aria-label={`Aprobar: ${summary.title}`}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border p-3 shadow-sm",
        isExecute ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            isExecute ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{summary.title}</p>
          <p className="text-xs text-muted-foreground">
            {isExecute ? "Sale del CRM: revisa antes de aprobar" : "Necesita tu aprobación"}
          </p>
        </div>
      </div>

      <div className="max-h-[40vh] space-y-2 overflow-y-auto">
        {summary.recipient && (
          <p className="text-sm">
            <span className="text-muted-foreground">Para: </span>
            <span className="font-medium text-foreground" data-testid="agent-approval-recipient">
              {summary.recipient}
            </span>
          </p>
        )}
        {summary.lines.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {summary.lines.map((line, i) => (
              <div key={`${i}-${line.label}`} className="contents">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{line.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {summary.note && <p className="text-xs text-muted-foreground">{summary.note}</p>}
        {input !== undefined && (
          <Collapsible className="group/tech">
            <CollapsibleTrigger className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronDown className="size-3 transition-transform group-data-open/tech:rotate-180" />
              Ver detalles técnicos
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 rounded-md bg-muted/50">
              <CodeBlock code={JSON.stringify(input, null, 2)} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!canRespond}
          onClick={() => onRespond(request.requestId, { optionId: "deny" })}
          data-testid="agent-approval-deny"
        >
          {APPROVAL_OPTION_LABELS.deny}
        </Button>
        <Button
          size="sm"
          disabled={!canRespond}
          onClick={() => onRespond(request.requestId, { optionId: "approve" })}
          data-testid="agent-approval-approve"
        >
          {APPROVAL_OPTION_LABELS.approve}
        </Button>
      </div>
    </section>
  );
};

const optionButtonVariant = (style: "danger" | "primary" | "default" | undefined) =>
  style === "danger" ? "destructive" : style === "primary" ? "default" : "outline";

/** The model's own `ask_question`: its options and/or a free answer. The question text also shows in the conversation. */
const QuestionBar = ({ part, canRespond, onRespond }: Omit<Props, "names">) => {
  const request = part.toolMetadata?.eve?.inputRequest;
  const [freeformValue, setFreeformValue] = useState("");
  if (!request) return null;
  const hasOptions = (request.options?.length ?? 0) > 0;

  const submitFreeform = () => {
    const text = freeformValue.trim();
    if (!text || !canRespond) return;
    onRespond(request.requestId, { text });
    setFreeformValue("");
  };

  // A real (if terse) answer: the model sees an explicit decline instead of
  // the question vanishing, so it stops pursuing it.
  const dismiss = () => {
    if (!canRespond) return;
    onRespond(request.requestId, { text: "Cancelar, no quiero continuar con esto por ahora." });
  };

  return (
    <section
      data-testid="agent-question-bar"
      aria-label="Pregunta del asistente"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm text-foreground">{sanitizePromptText(request.prompt)}</p>
        <Button variant="ghost" size="icon-xs" aria-label="Cerrar pregunta" disabled={!canRespond} onClick={dismiss}>
          <X className="size-3.5" />
        </Button>
      </div>
      {hasOptions && (
        <div className="flex flex-wrap gap-2">
          {(request.options ?? []).map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              disabled={!canRespond}
              variant={optionButtonVariant(opt.style)}
              onClick={() => onRespond(request.requestId, { optionId: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}
      {request.allowFreeform && (
        <div className="flex items-center gap-2">
          <Input
            value={freeformValue}
            onChange={(e) => setFreeformValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitFreeform();
            }}
            disabled={!canRespond}
            placeholder={hasOptions ? "O escribe tu respuesta…" : "Escribe tu respuesta…"}
            className="min-w-0 flex-1"
          />
          <Button
            size="icon-sm"
            aria-label="Enviar respuesta"
            disabled={!canRespond || !freeformValue.trim()}
            onClick={submitFreeform}
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      )}
    </section>
  );
};

/** Docked above the composer for whatever the run is blocked on, so it's reachable without scrolling back. */
export const PendingInputBar = (props: Props) => (
  <div className="mx-auto w-full max-w-2xl shrink-0 px-2.5 pt-2">
    {isApprovalPart(props.part) ? <ApprovalCard {...props} /> : <QuestionBar {...props} />}
  </div>
);
