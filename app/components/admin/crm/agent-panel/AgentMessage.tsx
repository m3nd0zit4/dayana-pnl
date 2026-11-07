"use client";

import { memo, useState } from "react";
import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { Copy, ExternalLink, FileIcon, ThumbsDown, ThumbsUp } from "lucide-react";
import { displayBlocksOf, type DisplayBlock } from "@/agent/lib/display";
import { isQuestionPart } from "@/lib/agent-ui/approval";
import { dedupeBlocks } from "@/lib/agent-ui/display-format";
import { dedupeRefs, extractRefs, type EntityRef } from "@/lib/agent-ui/refs";
import { buildActivity, formatDuration, isApprovalToolPart, latestPlan, type TurnTiming } from "@/lib/agent-ui/steps";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { ActivityRow, type ReasoningSummary } from "./agent-message/ActivityRow";
import { ApprovalReceipt } from "./agent-message/ApprovalReceipt";
import { DisplayBlocks } from "./agent-message/DisplayBlocks";
import { PlanChecklist } from "./agent-message/PlanChecklist";
import { RefChips } from "./agent-message/RefChips";
import { sanitizePromptText } from "./agent-message/sanitize-text";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "./ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai-elements/reasoning";
import { Shimmer } from "./ai-elements/shimmer";

type TextPart = Extract<EveMessagePart, { type: "text" }>;
type ReasoningPart = Extract<EveMessagePart, { type: "reasoning" }>;

const toolParts = (message: EveMessage): EveDynamicToolPart[] =>
  message.parts.filter((p): p is EveDynamicToolPart => p.type === "dynamic-tool");

const outputOf = (part: EveDynamicToolPart): unknown => ("output" in part ? part.output : undefined);

const collectRefs = (parts: EveDynamicToolPart[]): EntityRef[] =>
  dedupeRefs(parts.flatMap((p) => (outputOf(p) === undefined ? [] : extractRefs(outputOf(p)))));

const collectBlocks = (parts: EveDynamicToolPart[]): DisplayBlock[] =>
  dedupeBlocks(parts.flatMap((p) => displayBlocksOf(outputOf(p))));

const formatBytes = (size: number | undefined): string | undefined => {
  if (size === undefined) return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/** A sent attachment: a thumbnail for images, a file chip otherwise. */
const AttachmentPart = ({ part }: { part: Extract<EveMessagePart, { type: "file" }> }) => {
  const label = part.filename ?? "Adjunto";
  const detail = [part.mediaType, formatBytes(part.size)].filter(Boolean).join(" · ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;

  const body = (
    <span className="flex max-w-sm items-center gap-3 rounded-md border border-border bg-background/60 p-2 text-sm text-foreground">
      {isImage ? (
        // Usually a data: URI (attachments are inlined, never uploaded) — next/image can't optimize that.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={label} className="size-12 shrink-0 rounded-sm object-cover" src={part.url} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <FileIcon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail && <span className="block truncate text-muted-foreground">{detail}</span>}
      </span>
    </span>
  );

  return part.url ? (
    <a href={part.url} target="_blank" rel="noreferrer" download={part.filename}>
      {body}
    </a>
  ) : (
    body
  );
};

/** The model's own clarifying question, as prose; the answer controls are docked above the composer. */
const QuestionPrompt = ({ part, isLive }: { part: EveDynamicToolPart; isLive: boolean }) => {
  const request = part.toolMetadata?.eve?.inputRequest;
  if (!request) return null;
  const response = part.toolMetadata?.eve?.inputResponse;
  const answered = request.options?.find((o) => o.id === response?.optionId)?.label ?? response?.text;
  return (
    <div className="flex flex-col gap-1" data-testid="agent-question">
      <MessageResponse>{sanitizePromptText(request.prompt)}</MessageResponse>
      {isLive && part.state === "approval-requested" && <p className="text-xs text-muted-foreground">Responde abajo</p>}
      {answered && <p className="text-xs text-muted-foreground">Tu respuesta: {answered}</p>}
    </div>
  );
};

const AuthorizationPrompt = ({ part }: { part: Extract<EveMessagePart, { type: "authorization" }> }) =>
  part.state === "completed" ? (
    <p className="text-xs text-muted-foreground">
      {part.outcome === "authorized" ? `${part.displayName} quedó conectado.` : `${part.displayName}: no se pudo conectar.`}
    </p>
  ) : (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-sm">
      <p className="text-foreground">{part.description}</p>
      {part.authorization?.userCode && <code className="text-xs">{part.authorization.userCode}</code>}
      {part.authorization?.url && (
        <a
          href={part.authorization.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Conectar {part.displayName} <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );

const UserMessage = ({ message }: { message: EveMessage }) => (
  <Message from="user" data-optimistic={message.metadata?.optimistic ? "true" : undefined}>
    <MessageContent>
      {message.parts.map((part, index) =>
        part.type === "text" ? (
          // Not markdown: a pasted URL through Streamdown grows the bubble past the panel edge.
          <p key={index} className="w-full min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {part.text}
          </p>
        ) : part.type === "file" ? (
          <AttachmentPart key={index} part={part} />
        ) : null
      )}
    </MessageContent>
  </Message>
);

type AssistantProps = {
  message: EveMessage;
  isStreaming: boolean;
  /** The tool call the run is blocked on right now, if it's in this message. */
  pendingCallId: string | null;
  timing?: TurnTiming;
};

const AssistantMessage = ({ message, isStreaming, pendingCallId, timing }: AssistantProps) => {
  const { toast } = useCrm();
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const tools = toolParts(message);
  const activity = buildActivity(message.parts, pendingCallId);
  const reasoningParts = message.parts.filter((p): p is ReasoningPart => p.type === "reasoning");
  const reasoning: ReasoningSummary | null =
    reasoningParts.length > 0
      ? {
          text: reasoningParts.map((p) => p.text).join("\n\n"),
          streaming: isStreaming && reasoningParts.some((p) => p.state === "streaming"),
          ms: timing?.reasoningMs || undefined,
        }
      : null;
  const plan = latestPlan(message.parts);
  const blocks = collectBlocks(tools);
  const refs = collectRefs(tools);
  const lastTextIndex = message.parts.reduce((last, part, index) => (part.type === "text" ? index : last), -1);
  const textContent = message.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  const thinkingNow = Boolean(reasoning?.streaming) && !activity.running;
  const nothingYet = isStreaming && lastTextIndex === -1 && activity.steps.length === 0 && !reasoning;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(textContent);
    toast("Copiado", "success");
  };

  const handleFeedback = (value: "up" | "down") => {
    setFeedback(value);
    toast(value === "up" ? "Gracias por tu opinión" : "Gracias, lo tendremos en cuenta", "info");
  };

  return (
    <Message from="assistant" data-testid="agent-message">
      <MessageContent>
        {activity.steps.length > 0 ? (
          <ActivityRow
            activity={activity}
            reasoning={reasoning}
            thinkingNow={thinkingNow}
            durationMs={isStreaming ? undefined : timing?.totalMs}
          />
        ) : reasoning ? (
          <Reasoning
            defaultOpen={false}
            isStreaming={reasoning.streaming}
            duration={reasoning.ms ? Math.max(1, Math.round(reasoning.ms / 1000)) : undefined}
            className="mb-0"
            data-testid="agent-reasoning"
          >
            <ReasoningTrigger
              getThinkingMessage={(streaming, duration) =>
                streaming ? (
                  <Shimmer>Pensando…</Shimmer>
                ) : (
                  <span>{duration ? `Pensó ${formatDuration(duration * 1000)}` : "Pensó unos segundos"}</span>
                )
              }
            />
            <ReasoningContent className="mt-2 text-xs">{reasoning.text}</ReasoningContent>
          </Reasoning>
        ) : null}

        {nothingYet && <Shimmer className="text-sm">Pensando…</Shimmer>}

        {plan && <PlanChecklist items={plan} />}

        {message.parts.map((part, index) => {
          switch (part.type) {
            case "text":
              return (
                <MessageResponse
                  key={index}
                  caret={isStreaming && index === lastTextIndex ? "block" : undefined}
                  isAnimating={isStreaming && index === lastTextIndex}
                >
                  {part.text}
                </MessageResponse>
              );
            case "file":
              return <AttachmentPart key={index} part={part} />;
            case "authorization":
              return <AuthorizationPrompt key={index} part={part} />;
            case "dynamic-tool":
              if (isQuestionPart(part)) {
                return <QuestionPrompt key={part.toolCallId} part={part} isLive={part.toolCallId === pendingCallId} />;
              }
              if (isApprovalToolPart(part)) {
                return <ApprovalReceipt key={part.toolCallId} part={part} isLive={part.toolCallId === pendingCallId} />;
              }
              return null;
            default:
              return null;
          }
        })}

        <DisplayBlocks blocks={blocks} />
        <RefChips refs={refs} />
      </MessageContent>

      {textContent && !isStreaming && (
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

const AgentMessage = (props: AssistantProps) =>
  props.message.role === "user" ? <UserMessage message={props.message} /> : <AssistantMessage {...props} />;

export default memo(AgentMessage);
