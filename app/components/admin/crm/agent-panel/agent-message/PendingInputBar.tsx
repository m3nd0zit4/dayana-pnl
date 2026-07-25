"use client";

import { useState } from "react";
import type { EveDynamicToolPart, EveMessage } from "eve/react";
import { Input } from "@/app/components/ui/input";
import { ConfirmationAction, ConfirmationActions } from "../ai-elements/confirmation";
import { APPROVAL_OPTION_LABELS, isFrameworkApprovalGate } from "./framework-approval";
import { TOOL_LABELS } from "./tool-labels";

export type InputResponse = { optionId?: string; text?: string };
export type InputResponder = (requestId: string, response: InputResponse) => void;

/**
 * Finds the single input request the agent is currently blocked on, across
 * every message — the run pauses until it's resolved, so there's at most one
 * at a time. Used to render it docked above the composer instead of wherever
 * it happens to sit in the scrolled conversation history.
 */
export const findPendingInputPart = (messages: readonly EveMessage[]): EveDynamicToolPart | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (part.type === "dynamic-tool" && part.state === "approval-requested") {
        return part;
      }
    }
  }
  return null;
};

const optionButtonVariant = (style: "danger" | "primary" | "default" | undefined) =>
  style === "danger" ? "destructive" : style === "primary" ? "default" : "outline";

/** Sticky bar docked above the composer with the answer controls (option buttons and/or a freeform field) for whatever input request is currently pending — always reachable without scrolling back through the conversation. The question/confirmation text itself still renders inline in the message via `InputRequestPrompt`. */
export const PendingInputBar = ({
  part,
  canRespond,
  onRespond,
}: {
  part: EveDynamicToolPart;
  canRespond: boolean;
  onRespond: InputResponder;
}) => {
  const request = part.toolMetadata?.eve?.inputRequest;
  const [freeformValue, setFreeformValue] = useState("");
  if (!request) return null;

  const isGate = isFrameworkApprovalGate(request);
  const prompt = isGate ? `Confirmar: ${TOOL_LABELS[part.toolName] ?? part.toolName}` : request.prompt;
  const hasOptions = (request.options?.length ?? 0) > 0;

  const submitFreeform = () => {
    const text = freeformValue.trim();
    if (!text || !canRespond) return;
    onRespond(request.requestId, { text });
    setFreeformValue("");
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-2 border-t border-border px-3 pt-2.5 pb-1">
      <p className="text-sm text-foreground">{prompt}</p>
      {hasOptions && (
        <ConfirmationActions className="justify-start">
          {(request.options ?? []).map((opt) => (
            <ConfirmationAction
              key={opt.id}
              size="sm"
              disabled={!canRespond}
              variant={optionButtonVariant(opt.style)}
              onClick={() => onRespond(request.requestId, { optionId: opt.id })}
            >
              {isGate ? APPROVAL_OPTION_LABELS[opt.id as "approve" | "deny"] : opt.label}
            </ConfirmationAction>
          ))}
        </ConfirmationActions>
      )}
      {request.allowFreeform && (
        <div className="flex items-center gap-2">
          {hasOptions && <span className="text-xs text-muted-foreground">o escribe tu respuesta</span>}
          <Input
            value={freeformValue}
            onChange={(e) => setFreeformValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitFreeform();
            }}
            disabled={!canRespond}
            placeholder="Escribe tu respuesta…"
            className="max-w-xs"
          />
          <ConfirmationAction size="sm" disabled={!canRespond || !freeformValue.trim()} onClick={submitFreeform}>
            Enviar
          </ConfirmationAction>
        </div>
      )}
    </div>
  );
};
