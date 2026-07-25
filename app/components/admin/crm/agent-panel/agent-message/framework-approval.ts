/** Mirrors eve's own `isApprovalRequest` heuristic (see its slack/teams hitl.js channels) —
 *  detects the framework's auto-generated Yes/No gate (English "Approve tool call: X" / "Yes" /
 *  "No", from node_modules/eve/dist/src/harness/input-extraction.js) so we can re-skin it in
 *  Spanish, as opposed to a model-authored `ask_question` (which already arrives in Spanish per
 *  agent/instructions.md). */
export const isFrameworkApprovalGate = (request: {
  display?: string;
  options?: readonly { id: string }[];
}) =>
  request.display === "confirmation" &&
  request.options?.length === 2 &&
  request.options[0]?.id === "approve" &&
  request.options[1]?.id === "deny";

export const APPROVAL_OPTION_LABELS: Record<"approve" | "deny", string> = {
  approve: "Aprobar",
  deny: "Cancelar",
};
