/**
 * Approval gates as the panel sees them. Pure: no React, no eve runtime — the
 * shapes below are the structural subset of eve's `EveDynamicToolPart` the
 * panel reads, so the helpers stay testable with plain objects.
 */

export type InputRequestLike = {
  display?: string;
  options?: readonly { id: string; label?: string }[];
  prompt?: string;
  requestId?: string;
};

export type ToolPartLike = {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { approved?: boolean; isAutomatic?: boolean };
  toolMetadata?: {
    eve?: {
      kind?: string;
      name?: string;
      inputRequest?: InputRequestLike;
      inputResponse?: { optionId?: string; text?: string };
    };
  };
};

/**
 * Mirrors eve's own `isApprovalRequest` heuristic (its slack/teams hitl
 * channels): the framework's auto-generated gate is a two-option
 * confirmation, `approve` then `deny`. Anything else with an input request is
 * the model's own `ask_question`.
 */
export const isFrameworkApprovalGate = (request: InputRequestLike | undefined): boolean =>
  request?.display === "confirmation" &&
  request.options?.length === 2 &&
  request.options[0]?.id === "approve" &&
  request.options[1]?.id === "deny";

export const APPROVAL_OPTION_LABELS: Record<"approve" | "deny", string> = {
  approve: "Aprobar",
  deny: "Cancelar",
};

/** A tool call that waited (or is waiting) on the operator's approve/deny. */
export const isApprovalPart = (part: ToolPartLike): boolean => {
  if (part.toolName === "ask_question") return false;
  if (isFrameworkApprovalGate(part.toolMetadata?.eve?.inputRequest)) return true;
  return part.approval != null && part.approval.isAutomatic !== true;
};

/** The model's own clarifying question (`ask_question`), not a gate. */
export const isQuestionPart = (part: ToolPartLike): boolean =>
  part.toolMetadata?.eve?.inputRequest != null && !isApprovalPart(part);

export type ApprovalStatus = "pending" | "approved" | "denied" | "unanswered";

/**
 * `isLive` = this is the one request the run is blocked on right now (last
 * part of the last message). An `approval-requested` part anywhere else is a
 * stale replay from an old thread, never something to answer.
 */
export const approvalStatus = (part: ToolPartLike, isLive: boolean): ApprovalStatus => {
  const optionId = part.toolMetadata?.eve?.inputResponse?.optionId;
  if (part.state === "output-denied" || part.approval?.approved === false || optionId === "deny") {
    return "denied";
  }
  if (part.approval?.approved === true || optionId === "approve") return "approved";
  if (part.state === "approval-requested") return isLive ? "pending" : "unanswered";
  if (part.state === "output-available" || part.state === "output-error") return "approved";
  return "unanswered";
};
