"use client";

import Link from "next/link";
import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "./ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./ai-elements/tool";
import { extractRefs } from "./extract-refs";

type InputResponder = (requestId: string, optionId: string) => void;

const TOOL_LABELS: Record<string, string> = {
  search_contacts: "Buscando contactos",
  get_contact: "Consultando contacto",
  list_enrollments: "Listando inscripciones",
  get_enrollment: "Consultando inscripción",
  get_therapy_package: "Consultando paquete de terapia",
  list_products: "Listando productos",
  dashboard_stats: "Consultando estadísticas",
  query_audit_log: "Consultando auditoría",
  complete_therapy_session: "Completando sesión",
  uncomplete_therapy_session: "Revirtiendo sesión",
  schedule_therapy_session: "Agendando sesión",
  mark_therapy_session_no_show: "Marcando inasistencia",
  update_therapy_session: "Actualizando sesión",
};

const RefChips = ({ output }: { output: unknown }) => {
  const refs = extractRefs(output);
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {refs.map((ref) => (
        <Link
          key={ref.href}
          href={ref.href}
          target="_blank"
          className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
        >
          {ref.type} ↗
        </Link>
      ))}
    </div>
  );
};

const ToolPart = ({
  part,
  canRespond,
  onRespond,
}: {
  part: EveDynamicToolPart;
  canRespond: boolean;
  onRespond: InputResponder;
}) => {
  const label = TOOL_LABELS[part.toolName] ?? part.toolName;

  return (
    <Tool
      defaultOpen={part.state === "approval-requested" || part.state === "approval-responded"}
    >
      <ToolHeader state={part.state} title={label} toolName={part.toolName} />
      <ToolContent>
        <ToolInput input={"input" in part ? part.input : undefined} />
        {part.state === "approval-requested" && (
          <ApprovalPrompt part={part} canRespond={canRespond} onRespond={onRespond} />
        )}
        <ToolOutput
          output={"output" in part ? part.output : undefined}
          errorText={"errorText" in part ? part.errorText : undefined}
        >
          {"output" in part ? <RefChips output={part.output} /> : null}
        </ToolOutput>
      </ToolContent>
    </Tool>
  );
};

const ApprovalPrompt = ({
  part,
  canRespond,
  onRespond,
}: {
  part: EveDynamicToolPart;
  canRespond: boolean;
  onRespond: InputResponder;
}) => {
  const request = part.toolMetadata?.eve?.inputRequest;
  if (!request) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="mb-2 font-medium text-amber-900 dark:text-amber-200">{request.prompt}</p>
      <div className="flex flex-wrap gap-2">
        {(request.options ?? []).map((opt) => (
          <Button
            key={opt.id}
            size="sm"
            disabled={!canRespond}
            variant={opt.style === "danger" ? "destructive" : opt.style === "primary" ? "default" : "outline"}
            onClick={() => onRespond(request.requestId, opt.id)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
};

const AgentMessagePart = ({
  part,
  showCaret,
  canRespond,
  onRespond,
}: {
  part: EveMessagePart;
  showCaret: boolean;
  canRespond: boolean;
  onRespond: InputResponder;
}) => {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret={showCaret ? "block" : undefined} isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "dynamic-tool":
      return <ToolPart part={part} canRespond={canRespond} onRespond={onRespond} />;
    default:
      return null;
  }
};

const AgentMessage = ({
  message,
  isStreaming,
  canRespond,
  onRespond,
}: {
  message: EveMessage;
  isStreaming: boolean;
  canRespond: boolean;
  onRespond: InputResponder;
}) => {
  const { toast } = useCrm();
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const isUser = message.role === "user";

  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1
  );

  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(textContent);
    toast("Copiado", "success");
  };

  const handleFeedback = (value: "up" | "down") => {
    setFeedback(value);
    toast(value === "up" ? "Gracias por tu feedback" : "Gracias, lo tendremos en cuenta", "info");
  };

  return (
    <Message from={message.role} data-optimistic={message.metadata?.optimistic ? "true" : undefined}>
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            key={index}
            part={part}
            canRespond={canRespond}
            onRespond={onRespond}
            showCaret={isStreaming && !isUser && index === lastTextIndex}
          />
        ))}
      </MessageContent>

      {!isUser && textContent && (
        <MessageActions>
          <MessageAction tooltip="Copiar" onClick={handleCopy}>
            <Copy className="size-3.5" />
          </MessageAction>
          <MessageAction
            tooltip="Buena respuesta"
            onClick={() => handleFeedback("up")}
            className={feedback === "up" ? "text-foreground" : undefined}
          >
            <ThumbsUp className="size-3.5" />
          </MessageAction>
          <MessageAction
            tooltip="Mala respuesta"
            onClick={() => handleFeedback("down")}
            className={feedback === "down" ? "text-foreground" : undefined}
          >
            <ThumbsDown className="size-3.5" />
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
};

export default AgentMessage;
