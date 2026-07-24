"use client";

import Link from "next/link";
import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { ChevronRight, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { groupToolParts } from "./agent-message/group-tool-parts";
import { TOOL_LABELS } from "./agent-message/tool-labels";
import { ToolStepsGroup } from "./agent-message/ToolStepsGroup";
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationTitle } from "./ai-elements/confirmation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "./ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./ai-elements/tool";
import { extractRefs, type EntityRef } from "./extract-refs";
import { refTypeIcon } from "./ref-icons";

type InputResponder = (requestId: string, optionId: string) => void;

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
        />
      </ToolContent>
    </Tool>
  );
};

const optionButtonVariant = (style: "danger" | "primary" | "default" | undefined) =>
  style === "danger" ? "destructive" : style === "primary" ? "default" : "outline";

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
    <Confirmation>
      <ConfirmationTitle>{request.prompt}</ConfirmationTitle>
      <ConfirmationActions>
        {(request.options ?? []).map((opt) => (
          <ConfirmationAction
            key={opt.id}
            size="sm"
            disabled={!canRespond}
            variant={optionButtonVariant(opt.style)}
            onClick={() => onRespond(request.requestId, opt.id)}
          >
            {opt.label}
          </ConfirmationAction>
        ))}
      </ConfirmationActions>
    </Confirmation>
  );
};

/**
 * `ask_question` renders inline as part of the conversation — plain prose
 * plus a button row, like the assistant just asked something out loud —
 * instead of the generic `Tool` card chrome (icon, collapsible header,
 * raw parameter JSON) other tool calls get. It shares the same
 * approval-requested/-responded state machine, just with a chat-native look.
 */
const AskQuestionPart = ({
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

  const response = part.toolMetadata?.eve?.inputResponse;
  const answeredOption = request.options?.find((opt) => opt.id === response?.optionId);
  const answeredLabel = answeredOption?.label ?? response?.text;

  return (
    <div className="flex flex-col gap-2">
      <MessageResponse>{request.prompt}</MessageResponse>
      {part.state === "approval-requested" && (
        <ConfirmationActions className="justify-start">
          {(request.options ?? []).map((opt) => (
            <ConfirmationAction
              key={opt.id}
              size="sm"
              disabled={!canRespond}
              variant={optionButtonVariant(opt.style)}
              onClick={() => onRespond(request.requestId, opt.id)}
            >
              {opt.label}
            </ConfirmationAction>
          ))}
        </ConfirmationActions>
      )}
      {answeredLabel && <p className="text-xs text-muted-foreground">→ {answeredLabel}</p>}
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
      if (part.toolName === "ask_question") {
        return <AskQuestionPart part={part} canRespond={canRespond} onRespond={onRespond} />;
      }
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
              canRespond={canRespond}
              onRespond={onRespond}
              showCaret={isStreaming && !isUser && message.parts.indexOf(item.part) === lastTextIndex}
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
