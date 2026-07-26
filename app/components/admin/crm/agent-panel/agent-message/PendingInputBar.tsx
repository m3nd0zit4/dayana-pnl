"use client";

import { useState } from "react";
import type { EveDynamicToolPart, EveMessage } from "eve/react";
import { X } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { ConfirmationAction, ConfirmationActions } from "../ai-elements/confirmation";
import { APPROVAL_OPTION_LABELS, isFrameworkApprovalGate } from "./framework-approval";
import { sanitizePromptText } from "./sanitize-text";
import { TOOL_LABELS } from "./tool-labels";

export type InputResponse = { optionId?: string; text?: string };
export type InputResponder = (requestId: string, response: InputResponse) => void;

/**
 * Finds the single input request the agent is genuinely blocked on right
 * now. A live pause can only ever be the last part of the last message — the
 * run structurally cannot emit anything further until it's resolved — so we
 * only look there. This matters because eve's persisted event log has no
 * "resolved" event for a plain `ask_question` (unlike approval-gated write
 * tools, which get a correlating `action.result`); reopening an old thread
 * replays that stale request forever stuck in `approval-requested` state.
 * Restricting to the last message means a long-answered question buried
 * earlier in history is never mistaken for a live one.
 */
export const findPendingInputPart = (messages: readonly EveMessage[]): EveDynamicToolPart | null => {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return null;
  for (let j = lastMessage.parts.length - 1; j >= 0; j--) {
    const part = lastMessage.parts[j];
    if (part.type === "dynamic-tool" && part.state === "approval-requested") {
      return part;
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
  const prompt = isGate
    ? `Confirmar: ${TOOL_LABELS[part.toolName] ?? part.toolName}`
    : sanitizePromptText(request.prompt);
  const hasOptions = (request.options?.length ?? 0) > 0;

  const submitFreeform = () => {
    const text = freeformValue.trim();
    if (!text || !canRespond) return;
    onRespond(request.requestId, { text });
    setFreeformValue("");
  };

  // Sends a real (if terse) answer through the normal response channel — the
  // model sees an explicit decline instead of the question just vanishing,
  // so it can react and stop pursuing whatever it was asking about.
  const dismiss = () => {
    if (!canRespond) return;
    onRespond(request.requestId, { text: "Cancelar, no quiero continuar con esto por ahora." });
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-2 border-t border-border px-3 pt-2.5 pb-1">
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm text-foreground">{prompt}</p>
        <button
          type="button"
          aria-label="Cerrar pregunta"
          disabled={!canRespond}
          onClick={dismiss}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
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
