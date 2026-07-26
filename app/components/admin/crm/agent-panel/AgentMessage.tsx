"use client";

import Link from "next/link";
import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { ChevronDown, ChevronRight, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/components/ui/collapsible";
import { APPROVAL_OPTION_LABELS, isFrameworkApprovalGate } from "./agent-message/framework-approval";
import { groupToolParts } from "./agent-message/group-tool-parts";
import { sanitizePromptText } from "./agent-message/sanitize-text";
import { TOOL_LABELS } from "./agent-message/tool-labels";
import { ToolStepsGroup } from "./agent-message/ToolStepsGroup";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "./ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./ai-elements/tool";
import { extractRefs, type EntityRef } from "./extract-refs";
import { refTypeIcon } from "./ref-icons";

const collectMessageRefs = (message: EveMessage): EntityRef[] => {
  const out: EntityRef[] = [];
  for (const part of message.parts) {
    if (part.type === "dynamic-tool" && "output" in part) {
      for (const ref of extractRefs(part.output)) {
        if (!out.some((r) => r.href === ref.href)) out.push(ref);
      }
    }
  }
  return out;
};

const RefChips = ({ refs }: { refs: EntityRef[] }) => {
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {refs.map((ref) => {
        const Icon = refTypeIcon(ref.type);
        return (
          <Link
            key={ref.href}
            href={ref.href}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            {ref.label ?? ref.type}
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
    </div>
  );
};

const ToolPart = ({ part }: { part: EveDynamicToolPart }) => {
  const label = TOOL_LABELS[part.toolName] ?? part.toolName;

  return (
    <Tool>
      <ToolHeader state={part.state} title={label} toolName={part.toolName} />
      <ToolContent>
        <ToolInput input={"input" in part ? part.input : undefined} />
        <ToolOutput
          output={"output" in part ? part.output : undefined}
          errorText={"errorText" in part ? part.errorText : undefined}
        />
      </ToolContent>
    </Tool>
  );
};

/**
 * Renders any blocking input request the agent needs from a human — both the
 * model's own `ask_question` calls and the framework's non-bypassable
 * write-tool approval gate — through one consistent chat-native look: plain
 * prose, no `Tool` card chrome. The framework gate arrives with English
 * defaults (`display: "confirmation"`, options `[{id:"approve"},{id:"deny"}]`,
 * prompt `"Approve tool call: X"` — see
 * node_modules/eve/dist/src/harness/input-extraction.js) so its prompt is
 * overridden in Spanish via `isFrameworkApprovalGate`; a genuine
 * `ask_question` already arrives in Spanish per agent/instructions.md and is
 * rendered as-is. The answer controls themselves (option buttons / freeform
 * field) render separately, docked above the composer — see
 * `agent-message/PendingInputBar.tsx` — so they stay reachable without
 * scrolling back to wherever this message sits in the conversation.
 */
const InputRequestPrompt = ({ part, isLastMessage }: { part: EveDynamicToolPart; isLastMessage: boolean }) => {
  const request = part.toolMetadata?.eve?.inputRequest;
  if (!request) return null;

  const isGate = isFrameworkApprovalGate(request);
  const prompt = isGate
    ? `Confirmar: ${TOOL_LABELS[part.toolName] ?? part.toolName}`
    : sanitizePromptText(request.prompt);

  const response = part.toolMetadata?.eve?.inputResponse;
  const answeredOption = request.options?.find((opt) => opt.id === response?.optionId);
  const answeredLabel = isGate
    ? response?.optionId
      ? APPROVAL_OPTION_LABELS[response.optionId as "approve" | "deny"]
      : response?.text
    : (answeredOption?.label ?? response?.text);

  // A live pause can only ever be the last part of the last message (the run
  // can't emit anything further until it's resolved) — restricting to that
  // matches `findPendingInputPart` and keeps a long-answered ask_question
  // (whose resolution eve's event log has no way to record) from showing the
  // "responde abajo" hint forever after reopening an old thread.
  const isPending = part.state === "approval-requested" && isLastMessage;
  const toolInput = "input" in part ? part.input : undefined;

  return (
    <div className="flex flex-col gap-2">
      <MessageResponse>{prompt}</MessageResponse>

      {isGate && toolInput != null && (
        <Collapsible className="group">
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5 transition-transform group-data-open:rotate-180" />
            Ver detalles técnicos
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ToolInput input={toolInput} />
          </CollapsibleContent>
        </Collapsible>
      )}

      {isPending && <p className="text-xs text-muted-foreground">Responde abajo ↓</p>}
      {answeredLabel && <p className="text-xs text-muted-foreground">→ {answeredLabel}</p>}
    </div>
  );
};

const AgentMessagePart = ({
  part,
  showCaret,
  isLastMessage,
}: {
  part: EveMessagePart;
  showCaret: boolean;
  isLastMessage: boolean;
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
      if (part.state === "approval-requested" || part.state === "approval-responded") {
        return <InputRequestPrompt part={part} isLastMessage={isLastMessage} />;
      }
      return <ToolPart part={part} />;
    default:
      return null;
  }
};

const AgentMessage = ({
  message,
  isStreaming,
  isLastMessage,
}: {
  message: EveMessage;
  isStreaming: boolean;
  isLastMessage: boolean;
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

  const renderItems = groupToolParts(message.parts);
  const refs = isUser ? [] : collectMessageRefs(message);

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
        {renderItems.map((item, index) =>
          item.type === "tool-group" ? (
            <ToolStepsGroup key={`group-${index}`} parts={item.parts} />
          ) : (
            <AgentMessagePart
              key={index}
              part={item.part}
              showCaret={isStreaming && !isUser && message.parts.indexOf(item.part) === lastTextIndex}
              isLastMessage={isLastMessage}
            />
          )
        )}
        <RefChips refs={refs} />
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
