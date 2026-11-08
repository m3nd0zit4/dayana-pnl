import { describe, expect, test } from "bun:test";
import { createProxiedInputFixer } from "./proxied-input";

// The event order recorded on dev (8-nov): a second turn delegates to the
// WhatsApp specialist, which asks to approve a send.
const events = [
  { type: "actions.requested", data: { turnId: "turn_0", stepIndex: 0, actions: [{ callId: "c-pending" }] } },
  { type: "turn.completed", data: { turnId: "turn_0" } },
  { type: "actions.requested", data: { turnId: "turn_1", stepIndex: 1, actions: [{ callId: "c-whatsapp", kind: "subagent-call" }] } },
  { type: "subagent.called", data: { turnId: "turn_1", callId: "c-whatsapp", childSessionId: "child" } },
  {
    type: "input.requested",
    data: { turnId: "turn_0", stepIndex: 2, requests: [{ requestId: "r1", action: { callId: "c-send", toolName: "send_whatsapp_to_contact" } }] },
  },
];

describe("aprobaciones de un especialista", () => {
  test("van al turno y paso de la llamada al especialista, no al turno del hijo", () => {
    const fix = createProxiedInputFixer();
    const out = events.map(fix);
    expect(out[4].data).toMatchObject({ turnId: "turn_1", stepIndex: 1 });
    // Everything else is untouched.
    expect(out.slice(0, 4)).toEqual(events.slice(0, 4));
  });

  test("una aprobación del propio agente no se toca", () => {
    const fix = createProxiedInputFixer();
    const own = [
      { type: "actions.requested", data: { turnId: "turn_2", stepIndex: 0, actions: [{ callId: "c-own" }] } },
      { type: "input.requested", data: { turnId: "turn_2", stepIndex: 0, requests: [{ requestId: "r", action: { callId: "c-own" } }] } },
    ];
    expect(own.map(fix)).toEqual(own);
  });

  test("sin especialista en curso no se toca nada", () => {
    const fix = createProxiedInputFixer();
    const seq = [
      ...events.slice(0, 4),
      { type: "subagent.completed", data: { callId: "c-whatsapp" } },
      events[4],
    ];
    expect(seq.map(fix)[5]).toEqual(events[4]);
  });
});
