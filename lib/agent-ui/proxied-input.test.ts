import { describe, expect, test } from "bun:test";
import { defaultMessageReducer } from "eve/client";
import { createProxiedInputFixer, withProxiedInputs } from "./proxied-input";

type Ev = { type: string; data?: Record<string, unknown> };

// The event order recorded on dev (8-nov): a second turn delegates to the
// WhatsApp specialist, which asks to approve a send.
const events: Ev[] = [
  { type: "actions.requested", data: { turnId: "turn_0", stepIndex: 0, actions: [{ callId: "c-pending" }] } },
  { type: "turn.completed", data: { turnId: "turn_0" } },
  { type: "actions.requested", data: { turnId: "turn_1", stepIndex: 1, actions: [{ callId: "c-whatsapp", kind: "subagent-call" }] } },
  { type: "subagent.called", data: { turnId: "turn_1", callId: "c-whatsapp", childSessionId: "child" } },
  {
    type: "input.requested",
    data: { turnId: "turn_0", stepIndex: 2, requests: [{ requestId: "r1", action: { callId: "c-send", toolName: "send_whatsapp_to_contact" } }] },
  },
];

const fixAll = (list: Ev[]) => {
  const fix = createProxiedInputFixer();
  return list.flatMap((e) => fix(e));
};

describe("aprobaciones de un especialista", () => {
  test("van al turno y paso de la llamada al especialista, no al turno del hijo", () => {
    const out = fixAll(events);
    expect(out[4].data).toMatchObject({ turnId: "turn_1", stepIndex: 1 });
    expect(out.slice(0, 4)).toEqual(events.slice(0, 4));
  });

  test("una aprobación del propio agente no se toca", () => {
    const own: Ev[] = [
      { type: "actions.requested", data: { turnId: "turn_2", stepIndex: 0, actions: [{ callId: "c-own" }] } },
      { type: "input.requested", data: { turnId: "turn_2", stepIndex: 0, requests: [{ requestId: "r", action: { callId: "c-own" } }] } },
    ];
    expect(fixAll(own)).toEqual(own);
  });

  test("sin especialista en curso no se toca nada", () => {
    const seq = [...events.slice(0, 4), { type: "subagent.completed", data: { callId: "c-whatsapp" } }, events[4]];
    expect(fixAll(seq).at(-1)).toEqual(events[4]);
  });

  test("al terminar el especialista, la aprobación se cierra: aprobada → hecha", () => {
    const out = fixAll([
      ...events,
      { type: "client.input.responded", data: { responses: [{ requestId: "r1", optionId: "approve" }] } },
      { type: "subagent.completed", data: { callId: "c-whatsapp", output: "Listo, enviado." } },
    ]);
    const close = out.find((e) => e.type === "action.result");
    expect(close?.data).toMatchObject({ turnId: "turn_1", stepIndex: 1, status: "completed", result: { callId: "c-send" } });
    expect(out.at(-1)?.type).toBe("subagent.completed");
  });

  test("cancelada → denegada (por la respuesta o, en el historial, por «Cancelado»)", () => {
    const live = fixAll([
      ...events,
      { type: "client.input.responded", data: { responses: [{ requestId: "r1", optionId: "deny" }] } },
      { type: "subagent.completed", data: { callId: "c-whatsapp", output: "No envié nada." } },
    ]);
    expect(live.find((e) => e.type === "action.result")?.data).toMatchObject({ status: "failed", error: { code: "TOOL_EXECUTION_DENIED" } });
    const replay = fixAll([...events, { type: "subagent.completed", data: { callId: "c-whatsapp", output: "Cancelado: no envié el mensaje." } }]);
    expect(replay.find((e) => e.type === "action.result")?.data).toMatchObject({ status: "failed" });
  });

  // Production, 8-nov 16:33 (trimmed): delegation, approval, then the parent
  // answers in a continuation with turnId "". Nothing may stay running.
  test("la conversación real de producción no deja ningún paso girando", () => {
    const prod: Ev[] = [
      { type: "session.started", data: {} },
      { type: "turn.started", data: { turnId: "turn_0", sequence: 0 } },
      { type: "message.received", data: { turnId: "turn_0", sequence: 0, message: "agenda hoy de 5 a 7", parts: [{ type: "text", text: "agenda hoy de 5 a 7" }] } },
      { type: "step.started", data: { turnId: "turn_0", sequence: 0, stepIndex: 0 } },
      { type: "step.completed", data: { turnId: "turn_0", sequence: 0, stepIndex: 0, finishReason: "tool-calls" } },
      { type: "step.started", data: { turnId: "turn_0", sequence: 0, stepIndex: 1 } },
      {
        type: "actions.requested",
        data: {
          turnId: "turn_0",
          sequence: 0,
          stepIndex: 1,
          actions: [{ kind: "subagent-call", name: "whatsapp", subagentName: "whatsapp", callId: "call_sub", input: { message: "…" }, nodeId: "subagents/whatsapp" }],
        },
      },
      { type: "step.completed", data: { turnId: "turn_0", sequence: 0, stepIndex: 1, finishReason: "tool-calls" } },
      { type: "subagent.called", data: { turnId: "turn_0", callId: "call_sub", name: "whatsapp", toolName: "whatsapp", childSessionId: "child" } },
      {
        type: "input.requested",
        data: {
          turnId: "turn_0",
          sequence: 0,
          stepIndex: 1,
          requests: [
            {
              requestId: "req_1",
              prompt: "Approve tool call: whatsapp_update_config",
              display: "confirmation",
              allowFreeform: false,
              options: [{ id: "approve", label: "Yes" }, { id: "deny", label: "No" }],
              action: { kind: "tool-call", callId: "call_child", toolName: "whatsapp_update_config", input: { patch: {} } },
            },
          ],
        },
      },
      { type: "turn.completed", data: { turnId: "turn_0", sequence: 0 } },
      { type: "session.waiting", data: { wait: "next-user-message" } },
      { type: "client.input.responded", data: { responses: [{ requestId: "req_1", optionId: "approve" }] } },
      { type: "subagent.completed", data: { callId: "call_sub", subagentName: "whatsapp", output: "Se ha actualizado la configuración." } },
      {
        type: "action.result",
        data: {
          turnId: "turn_0",
          sequence: 0,
          stepIndex: 1,
          status: "completed",
          result: { kind: "subagent-result", callId: "call_sub", subagentName: "whatsapp", output: "Se ha actualizado la configuración." },
        },
      },
      { type: "step.started", data: { turnId: "", sequence: 1, stepIndex: 0 } },
      { type: "message.completed", data: { turnId: "", sequence: 1, stepIndex: 0, message: "Listo, ya quedó configurada.", finishReason: "stop" } },
      { type: "step.completed", data: { turnId: "", sequence: 1, stepIndex: 0, finishReason: "stop" } },
      { type: "turn.completed", data: { turnId: "", sequence: 1 } },
      { type: "session.waiting", data: { wait: "next-user-message" } },
    ];
    const reducer = withProxiedInputs(defaultMessageReducer());
    let data = reducer.initial();
    for (const e of prod) data = reducer.reduce(data, e as never);
    const states = data.messages.flatMap((m) =>
      m.parts.flatMap((p) => (p.type === "dynamic-tool" ? [`${p.toolName}:${p.state}`] : []))
    );
    expect(states).toContain("whatsapp_update_config:output-available");
    expect(states.some((s) => /:(approval-requested|approval-responded|input-available|input-streaming)$/.test(s))).toBe(false);
  });
});
