/**
 * Approvals asked by a specialist (an eve subagent) reach the panel as an
 * `input.requested` proxied from the child session, but carrying the CHILD's
 * `turnId` / `stepIndex` («turn_0», step 2) instead of the parent's. eve's
 * message reducer files a part under the assistant message of that turnId, so
 * on any turn but the first the approval card landed in an old answer, the
 * panel never showed it and the run looked stuck on «Ejecutando…» forever
 * (production, 8-nov: «escríbele a … para proponerle otra hora»).
 *
 * `createProxiedInputFixer()` returns a stateful event mapper: it remembers
 * the parent's own tool calls and the specialist calls still running, and
 * rewrites a proxied request's `turnId` / `stepIndex` to those of the
 * specialist call that asked for it. Events of the parent pass untouched.
 * Use one fixer per ordered event stream (a fresh one per replay).
 */

type AnyEvent = { type: string; data?: unknown };

type Place = { turnId: unknown; stepIndex: unknown };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const createProxiedInputFixer = () => {
  /** Every tool call the parent itself requested, with where it lives. */
  const parentCalls = new Map<string, Place>();
  /** Specialist calls started and not completed yet, newest last. */
  const running: string[] = [];

  return <E extends AnyEvent>(event: E): E => {
    const data = record(event.data);

    if (event.type === "actions.requested") {
      for (const action of (data.actions ?? []) as unknown[]) {
        const callId = record(action).callId;
        if (typeof callId === "string") parentCalls.set(callId, { turnId: data.turnId, stepIndex: data.stepIndex });
      }
      return event;
    }
    if (event.type === "subagent.called") {
      const callId = data.callId;
      if (typeof callId === "string" && parentCalls.has(callId)) running.push(callId);
      return event;
    }
    if (event.type === "subagent.completed") {
      const at = running.lastIndexOf(String(data.callId));
      if (at !== -1) running.splice(at, 1);
      return event;
    }
    if (event.type !== "input.requested" || running.length === 0) return event;

    const requests = (data.requests ?? []) as unknown[];
    const proxied =
      requests.length > 0 &&
      requests.every((request) => {
        const callId = record(record(request).action).callId;
        return typeof callId === "string" && !parentCalls.has(callId);
      });
    if (!proxied) return event;

    const place = parentCalls.get(running[running.length - 1]);
    if (!place) return event;
    return { ...event, data: { ...data, turnId: place.turnId, stepIndex: place.stepIndex } };
  };
};

/** Wraps an eve message reducer so proxied approvals land in the right turn. */
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
    reduce: (data, event) => base.reduce(data, fix(event)),
  };
};
