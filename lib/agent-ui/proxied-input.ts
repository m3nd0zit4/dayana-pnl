/**
 * Approvals asked by a specialist (an eve subagent) reach the panel as an
 * `input.requested` proxied from the child session, but carrying the CHILD's
 * `turnId` / `stepIndex` («turn_0», step 2) instead of the parent's. eve's
 * message reducer files a part under the assistant message of that turnId, so
 * on any turn but the first the approval card landed in an old answer, the
 * panel never showed it and the run looked stuck on «Ejecutando…» forever
 * (production, 8-nov: «escríbele a … para proponerle otra hora»).
 *
 * The tool the operator approved then runs INSIDE the child, whose
 * `action.result` is never proxied: the card's step stayed «running» after the
 * specialist had finished and the parent had answered (8-nov, 16:33: «la IA de
 * WhatsApp ya quedó configurada» under a spinner). When the specialist
 * completes, every request it proxied is closed with a synthetic result: done,
 * or denied when the operator answered «deny» (known from the client's own
 * `client.input.responded`) or, replaying a saved thread without those, when
 * the specialist's report starts with «Cancelado».
 *
 * `createProxiedInputFixer()` returns a stateful mapper from one event to the
 * events to reduce. Use one per ordered stream (a fresh one per replay).
 */

type AnyEvent = { type: string; data?: unknown };

type Place = { turnId: unknown; stepIndex: unknown };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** Marker on synthetic results, for whoever needs to tell them apart. */
export const PROXIED_RESULT = "eve:proxied";

export const createProxiedInputFixer = () => {
  /** Every tool call the parent itself requested, with where it lives. */
  const parentCalls = new Map<string, Place>();
  /** Specialist calls started and not completed yet, newest last. */
  const running: string[] = [];
  /** Proxied requests by specialist call: the child's call id and the request id. */
  const proxiedBy = new Map<string, { callId: string; requestId: string }[]>();
  /** The operator's answers seen on this stream (live only). */
  const answers = new Map<string, string>();

  return <E extends AnyEvent>(event: E): E[] => {
    const data = record(event.data);

    if (event.type === "client.input.responded") {
      for (const response of (data.responses ?? []) as unknown[]) {
        const r = record(response);
        if (typeof r.requestId === "string" && typeof r.optionId === "string") answers.set(r.requestId, r.optionId);
      }
      return [event];
    }
    if (event.type === "actions.requested") {
      for (const action of (data.actions ?? []) as unknown[]) {
        const callId = record(action).callId;
        if (typeof callId === "string") parentCalls.set(callId, { turnId: data.turnId, stepIndex: data.stepIndex });
      }
      return [event];
    }
    if (event.type === "subagent.called") {
      const callId = data.callId;
      if (typeof callId === "string" && parentCalls.has(callId)) running.push(callId);
      return [event];
    }
    if (event.type === "subagent.completed") {
      const parentCall = String(data.callId);
      const at = running.lastIndexOf(parentCall);
      if (at !== -1) running.splice(at, 1);
      const place = parentCalls.get(parentCall);
      const pending = proxiedBy.get(parentCall) ?? [];
      proxiedBy.delete(parentCall);
      if (!place || pending.length === 0) return [event];
      const report = typeof data.output === "string" ? data.output : "";
      const closes = pending.map(({ callId, requestId }) => {
        const answer = answers.get(requestId);
        const denied = answer ? answer === "deny" : /^\s*cancelad[oa]\b/i.test(report);
        return {
          type: "action.result",
          data: {
            turnId: place.turnId,
            stepIndex: place.stepIndex,
            status: denied ? "failed" : "completed",
            ...(denied ? { error: { code: "TOOL_EXECUTION_DENIED", message: "Cancelado por el operador." } } : {}),
            result: { kind: "tool-result", callId, output: { [PROXIED_RESULT]: true } },
          },
        } as unknown as E;
      });
      return [...closes, event];
    }
    if (event.type !== "input.requested" || running.length === 0) return [event];

    const requests = (data.requests ?? []) as unknown[];
    const proxied =
      requests.length > 0 &&
      requests.every((request) => {
        const callId = record(record(request).action).callId;
        return typeof callId === "string" && !parentCalls.has(callId);
      });
    if (!proxied) return [event];

    const parentCall = running[running.length - 1];
    const place = parentCalls.get(parentCall);
    if (!place) return [event];
    const list = proxiedBy.get(parentCall) ?? [];
    for (const request of requests) {
      const r = record(request);
      list.push({ callId: String(record(r.action).callId), requestId: String(r.requestId) });
    }
    proxiedBy.set(parentCall, list);
    return [{ ...event, data: { ...data, turnId: place.turnId, stepIndex: place.stepIndex } }];
  };
};

/** Wraps an eve message reducer so specialist approvals land in the right turn and close when it ends. */
export const withProxiedInputs = <D, E extends AnyEvent>(base: {
  initial: () => D;
  reduce: (data: D, event: E) => D;
}): { initial: () => D; reduce: (data: D, event: E) => D } => {
  let fix = createProxiedInputFixer();
  return {
    initial: () => {
      fix = createProxiedInputFixer();
      return base.initial();
    },
    reduce: (data, event) => fix(event).reduce(base.reduce, data),
  };
};
