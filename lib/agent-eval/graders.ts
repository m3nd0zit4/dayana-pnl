/**
 * Code graders for the panel agents' evals (`scripts/agent/eval.ts`). Pure:
 * they read a recorded run, so they are unit-tested without a model.
 *
 * What a run is: per turn, the assistant texts in order, the tool calls the
 * root session asked for (a delegation shows up as a call named after the
 * specialist), and the input requests (approvals and questions) in the order
 * they were raised.
 */

export type RecordedRequest = {
  kind: "approval" | "question";
  /** The tool an approval gates; the question's prompt for a question. */
  tool?: string;
  prompt?: string;
  options: string[];
  /** Index into `texts` of the last assistant text before the request. */
  afterText: number;
};

export type RecordedTurn = {
  say: string;
  texts: string[];
  tools: { name: string; input: unknown }[];
  requests: RecordedRequest[];
  status: "waiting" | "completed" | "failed";
  error?: string;
  /** Final reply shown to the operator (last assistant text). */
  reply: string;
  ms: number;
};

export type TurnExpect = {
  /** At least one of these tools (or specialists) must be called. */
  anyTool?: string[];
  /** Every one of these must be called. */
  allTools?: string[];
  /** None of these may be called. */
  noTools?: string[];
  /** Exact number of approval cards in the turn. Default: no check. */
  approvals?: number;
  /** The reply must match every pattern. */
  replyMatches?: RegExp[];
  /** The reply must match none. */
  replyAvoids?: RegExp[];
  /** Allow `ask_question` in this turn (real ambiguity). Default false. */
  allowQuestion?: boolean;
};

export type Failure = { check: string; detail: string };

/** «¿Confirmas…?» and friends: what the double approval looked like. */
const ASKS_TO_CONFIRM =
  /¿\s*(lo\s+)?(confirmas|confirma|procedo|lo hago|deseas que|quieres que (lo|la|te) (cree|envíe|registre|haga)|estás de acuerdo|te parece bien que)/i;

/** A yes/no question card: the other half of the double approval. */
const YES_NO = /^(s[ií]|no|confirmar|cancelar|aprobar|yes)$/i;

/** cuid / eve ids the reply should never paste. */
const RAW_ID = /\b(c[a-z0-9]{23,26}|wrun_[A-Z0-9]{10,}|staff_dev_[a-z]+|call_\d{6,})\b/;

export const isApprovalGate = (options: string[]) =>
  options.length === 2 && options.includes("approve") && options.includes("deny");

export function gradeTurn(turn: RecordedTurn, expect: TurnExpect): Failure[] {
  const failures: Failure[] = [];
  const called = new Set(turn.tools.map((t) => t.name));

  if (turn.status === "failed") failures.push({ check: "run", detail: turn.error ?? "turn failed" });

  if (expect.anyTool && !expect.anyTool.some((t) => called.has(t))) {
    failures.push({ check: "anyTool", detail: `esperaba uno de ${expect.anyTool.join(", ")}; llamó ${[...called].join(", ") || "nada"}` });
  }
  for (const t of expect.allTools ?? []) {
    if (!called.has(t)) failures.push({ check: "allTools", detail: `no llamó ${t}` });
  }
  for (const t of expect.noTools ?? []) {
    if (called.has(t)) failures.push({ check: "noTools", detail: `llamó ${t}` });
  }

  const approvals = turn.requests.filter((r) => r.kind === "approval");
  if (expect.approvals !== undefined && approvals.length !== expect.approvals) {
    failures.push({ check: "approvals", detail: `${approvals.length} aprobaciones, se esperaban ${expect.approvals}` });
  }

  // Approval exactly once: no yes/no question and no «¿confirmas?» text ahead of a card.
  const questions = turn.requests.filter((r) => r.kind === "question");
  if (!expect.allowQuestion && questions.length > 0) {
    failures.push({ check: "question", detail: `preguntó con ask_question: ${questions[0].prompt ?? ""}` });
  }
  for (const approval of approvals) {
    const before = turn.texts.slice(0, approval.afterText + 1).join("\n");
    if (ASKS_TO_CONFIRM.test(before)) {
      failures.push({ check: "doubleApproval", detail: `pidió confirmación en texto antes de la tarjeta de ${approval.tool}` });
    }
    const yesNoBefore = questions.some((q) => q.options.length > 0 && q.options.every((o) => YES_NO.test(o)));
    if (yesNoBefore) failures.push({ check: "doubleApproval", detail: `preguntó Sí/No antes de la tarjeta de ${approval.tool}` });
  }

  const reply = turn.reply.trim();
  if (turn.status !== "failed" && !reply && approvals.length === 0) {
    failures.push({ check: "reply", detail: "respuesta vacía" });
  }
  if (RAW_ID.test(reply)) failures.push({ check: "rawId", detail: `pegó un id: ${reply.match(RAW_ID)?.[0]}` });
  for (const re of expect.replyMatches ?? []) {
    if (!re.test(reply)) failures.push({ check: "replyMatches", detail: `la respuesta no dice ${re}` });
  }
  for (const re of expect.replyAvoids ?? []) {
    if (re.test(reply)) failures.push({ check: "replyAvoids", detail: `la respuesta dice ${re}` });
  }
  return failures;
}
